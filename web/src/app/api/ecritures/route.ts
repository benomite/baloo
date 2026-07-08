import { z } from 'zod';
import {
  listEcritures,
  type EcritureFilters,
} from '@/lib/services/ecritures';
import {
  createEcritureAndPushToCw,
  CwPushFailedError,
  CwLocalUpdateFailedError,
  type EcriturePayload,
} from '@/lib/services/ecritures-create';
import { getDb } from '@/lib/db';
import { ensureBusinessSchema } from '@/lib/db/business-schema';
import { ECRITURE_STATUSES } from '@/lib/types';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';
import { resolveStatusFilter } from './status-filter';
import { ensureComptawebEnv } from '@/lib/comptaweb/env-loader';
import { loadConfig } from '@/lib/comptaweb/auth';
import { defaultCwScraper } from '@/lib/services/ecritures-create-cw-adapter';

ensureComptawebEnv();

// Doctrine (pivot miroir strict + MCP-first) :
// GET /api/ecritures sert le miroir CW propre. Par défaut, ne retourne
// que `status='mirror'`. L'opt-in `?includeDivergent=1` ajoute les
// `divergent`. Les drafts / pending_cw / pending_sync vivent sur /inbox
// — ils ne sortent JAMAIS via cet endpoint sauf override explicite via
// `?status=draft` (cas usage MCP/audit).
const listSchema = z
  .object({
    unite_id: z.string().optional(),
    category_id: z.string().optional(),
    type: z.enum(['depense', 'recette']).optional(),
    date_debut: z.string().optional(),
    date_fin: z.string().optional(),
    mode_paiement_id: z.string().optional(),
    carte_id: z.string().optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    status: z.enum(ECRITURE_STATUSES).optional(),
    // Opt-in : si `1`/`true`, ajoute les `divergent` aux `mirror` du
    // filtre par défaut. Ignoré si `status` est forcé.
    includeDivergent: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    incomplete: z.coerce.boolean().optional(),
    from_bank: z.coerce.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteIds } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const { includeDivergent, status, ...rest } = parsed.data;
  const statusIn = resolveStatusFilter({ status, includeDivergent });
  const filters: EcritureFilters = { ...rest, statusIn };

  return Response.json(await listEcritures({ groupId, scopeUniteIds }, filters));
}

const ventilationSchema = z.object({
  amount_cents: z.number().int(),
  category_id: z.string().nullish(),
  unite_id: z.string().nullish(),
  activite_id: z.string().nullish(),
});

// Multi-ventilation (S0, 2026-07-08) : l'imputation (catégorie/unité/
// activité) vit désormais dans `ventilations[]`, pas au niveau racine.
// `amount_cents` racine reste le TOTAL — `.refine` valide l'invariant
// somme = total en défense en profondeur (déjà validé côté adapter CW
// et service, cf. AGENTS.md "Grain canonique... = la VENTILATION").
export const createSchema = z.object({
  date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount_cents: z.number().int(),
  type: z.enum(['depense', 'recette']),
  mode_paiement_id: z.string().nullish(),
  numero_piece: z.string().nullish(),
  carte_id: z.string().nullish(),
  justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  notes: z.string().nullish(),
  ventilations: z.array(ventilationSchema).min(1),
}).refine(
  (d) => d.ventilations.reduce((s, v) => s + v.amount_cents, 0) === d.amount_cents,
  { message: 'La somme des ventilations doit égaler le montant total.', path: ['ventilations'] },
);

// Task 7 du pivot miroir strict + MCP-first :
// POST /api/ecritures est la porte d'entrée "user-initiated" (front ou
// MCP) pour créer une écriture. Le flux est piloté par
// `createEcritureAndPushToCw` :
//   1. INSERT BDD `pending_cw` (snapshot du payload).
//   2. Push CW via le scraper.
//   3a. Succès → status=`pending_sync` + cw_numero_piece, HTTP 201.
//   3b. Échec CW → status=`draft`, HTTP 502 avec `fallback_status` et
//       `ecriture_id` pour que le caller puisse retomber sur du
//       copier-coller manuel via /inbox.
//
// L'adapter scraper (résolution Baloo IDs → CW référentiels +
// construction du `CreateEcritureInput`) sera livré en Task 8. Tant
// qu'il n'est pas branché, on retombe sur la branche 502 (l'écriture
// est bien stockée en draft).
export async function POST(request: Request) {
  // `requireApiContext` déclenche déjà `ensureAuthSchema()` (Bearer)
  // ou l'adapter Auth.js (cookie), qui appellent tous les deux
  // `ensureBusinessSchema()` en amont. On ajoute néanmoins un appel
  // défensif ici : il garantit que la colonne `cw_numero_piece`
  // (ajoutée en Task 7) existe avant l'INSERT/UPDATE, y compris si
  // l'ordre des migrations évolue ou si la BDD est recréée à froid.
  // C'est un no-op après le premier appel du process (cache interne).
  await ensureBusinessSchema();

  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;

  const payload: EcriturePayload = parsed.data;
  try {
    const result = await createEcritureAndPushToCw(getDb(), {
      payload,
      group_id: groupId,
      // Adapter Baloo → CW (Task 8) : résout category_id → natureId,
      // mode_paiement_id → modetransactionId, etc., puis appelle le
      // scraper bas niveau `createEcriture`. Si un mapping CW manque,
      // l'adapter throw → caller voit un 502 avec un message explicite.
      cwScraper: defaultCwScraper,
      cwConfigLoader: loadConfig,
    });
    return Response.json({ ok: true, ecriture: result }, { status: 201 });
  } catch (err) {
    // Échec CW (scraper rejette / config KO) → l'écriture est en
    // `draft`. On utilise l'`ecritureId` porté par l'erreur (pas de
    // requête non-déterministe sujette aux race conditions entre POST
    // concurrents).
    if (err instanceof CwPushFailedError) {
      return Response.json(
        {
          ok: false,
          error: 'cw_write_failed',
          message: err.message,
          fallback_status: 'draft' as const,
          ecriture_id: err.ecritureId,
        },
        { status: 502 },
      );
    }
    // CW a accepté mais l'UPDATE local a planté : état grave (Baloo
    // dit `pending_cw`, CW a la donnée avec ce cw_numero_piece). Un
    // retry client créerait un doublon. La sync incrémentale Phase 2
    // ramassera l'écriture par `cw_numero_piece` et la promouvra,
    // mais en attendant on signale explicitement la désynchro pour
    // qu'un humain (ou un monitoring) puisse arbitrer.
    if (err instanceof CwLocalUpdateFailedError) {
      return Response.json(
        {
          ok: false,
          error: 'cw_synced_but_local_update_failed',
          message: err.message,
          cw_numero_piece: err.cwNumeroPiece,
          ecriture_id: err.ecritureId,
        },
        { status: 500 },
      );
    }
    // Erreur non identifiée (INSERT pending_cw qui plante, etc.) :
    // propage en 500 générique.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: 'internal_error', message },
      { status: 500 },
    );
  }
}
