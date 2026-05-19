import { z } from 'zod';
import {
  listEcritures,
  type EcritureFilters,
} from '@/lib/services/ecritures';
import {
  createEcritureAndPushToCw,
  type EcriturePayload,
} from '@/lib/services/ecritures-create';
import { getDb } from '@/lib/db';
import { ECRITURE_STATUSES } from '@/lib/types';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';
import { resolveStatusFilter } from './status-filter';
import { ensureComptawebEnv } from '@/lib/comptaweb/env-loader';
import { loadConfig } from '@/lib/comptaweb/auth';

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
  const { groupId, scopeUniteId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const { includeDivergent, status, ...rest } = parsed.data;
  const statusIn = resolveStatusFilter({ status, includeDivergent });
  const filters: EcritureFilters = { ...rest, statusIn };

  return Response.json(await listEcritures({ groupId, scopeUniteId }, filters));
}

const createSchema = z.object({
  date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount_cents: z.number().int(),
  type: z.enum(['depense', 'recette']),
  unite_id: z.string().nullish(),
  category_id: z.string().nullish(),
  mode_paiement_id: z.string().nullish(),
  activite_id: z.string().nullish(),
  numero_piece: z.string().nullish(),
  carte_id: z.string().nullish(),
  justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  notes: z.string().nullish(),
});

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
      // cwScraper non fourni : Task 8 fournira l'adapter Baloo → CW.
      // En attendant, le service rétrograde l'écriture en `draft` et
      // throw — capté ci-dessous pour renvoyer 502 avec ecriture_id.
      cwConfigLoader: loadConfig,
    });
    return Response.json({ ok: true, ecriture: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Recherche de l'écriture rétrogradée pour la retourner au caller
    // (utile au front pour rediriger vers /inbox et reprendre la saisie).
    // On lit la plus récente du groupe en `draft` ; pas parfait, mais
    // le service garantit qu'elle existe et c'est forcément la dernière.
    const lastDraft = await getDb()
      .prepare(
        `SELECT id FROM ecritures
           WHERE group_id = ? AND status = 'draft'
           ORDER BY updated_at DESC LIMIT 1`,
      )
      .get<{ id: string }>(groupId);
    return Response.json(
      {
        ok: false,
        error: 'cw_write_failed',
        message,
        fallback_status: 'draft' as const,
        ecriture_id: lastDraft?.id ?? null,
      },
      { status: 502 },
    );
  }
}
