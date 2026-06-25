import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listEcritures, updateEcriture } from '@/lib/services/ecritures';
import {
  createEcritureAndPushToCw,
  CwPushFailedError,
  CwLocalUpdateFailedError,
  type EcriturePayload,
} from '@/lib/services/ecritures-create';
import { defaultCwScraper } from '@/lib/services/ecritures-create-cw-adapter';
import { loadConfig } from '@/lib/comptaweb/auth';
import { getDb } from '@/lib/db';
import { ECRITURE_STATUSES, type EcritureStatus } from '@/lib/types';
import { pendingStatuses } from '@/lib/services/ecritures-status';
import { parseAmount } from '@/lib/format';

const ECRITURE_STATUS_ENUM = z.enum(ECRITURE_STATUSES);

export function registerEcrituresTools(server: McpServer, ctx: McpContext) {
  const ecritureCtx = { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId };

  // ─── list_ecritures (étendu) ───────────────────────────────────────────
  //
  // Surface étendue par rapport à la version Phase 1 initiale : ajoute
  // `status` (string ou tableau), `carte_id`, `mode_paiement_id`,
  // `comptaweb_ecriture_id`, `pending_only`. La sémantique de
  // `unmatched_only` historique a été remplacée par `pending_only` :
  // utilise les statuts pending (draft/pending_cw/pending_sync) au
  // lieu de l'ancien flag comptaweb_synced=0.
  server.tool(
    'list_ecritures',
    'Liste les écritures comptables, filtrables par type, période, statut, catégorie, mode de paiement, carte, ID Comptaweb. Par défaut, renvoie toutes statuts confondus (ajuste avec `status` ou `pending_only`).',
    {
      type: z.enum(['depense', 'recette']).optional(),
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      category_id: z.string().optional(),
      unite_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      carte_id: z.string().optional(),
      status: z
        .union([ECRITURE_STATUS_ENUM, z.array(ECRITURE_STATUS_ENUM).min(1)])
        .optional()
        .describe('Filtre par statut (valeur ou liste). Ex: ["draft","pending_cw"]'),
      comptaweb_ecriture_id: z.number().int().optional(),
      pending_only: z
        .boolean()
        .optional()
        .describe(
          'Si true : ne renvoie que les écritures pending (draft / pending_cw / pending_sync), ' +
            "remplace l'ancien filtre unmatched_only (qui regardait comptaweb_synced=0).",
        ),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).optional(),
    },
    async (params) => {
      const { status, comptaweb_ecriture_id, pending_only, ...rest } = params;
      let statusIn: string[] | undefined;
      let statusSingle: string | undefined;
      if (Array.isArray(status)) statusIn = status;
      else if (status) statusSingle = status;
      if (pending_only) statusIn = pendingStatuses();

      const filters = {
        ...rest,
        status: statusSingle,
        statusIn,
      };

      const result = await listEcritures(ecritureCtx, filters);

      // Filtre post-query sur comptaweb_ecriture_id (pas exposé en filter
      // direct côté service mais simple à appliquer ici — usage MCP/audit).
      const ecritures = comptaweb_ecriture_id
        ? result.ecritures.filter(
            (e) => (e as { comptaweb_ecriture_id?: number | null }).comptaweb_ecriture_id === comptaweb_ecriture_id,
          )
        : result.ecritures;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ecritures,
                total: comptaweb_ecriture_id ? ecritures.length : result.total,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── create_ecriture ──────────────────────────────────────────────────
  //
  // Pivot miroir strict : ce tool NE FAIT PAS un INSERT direct en BDD.
  // Il passe par `createEcritureAndPushToCw` (cycle pending_cw →
  // pending_sync, ou rétrograde à draft si CW est indisponible).
  server.tool(
    'create_ecriture',
    [
      "Crée une écriture NEUVE dans Comptaweb (via scraping) puis miroir en BDD Baloo.",
      "⚠️ Ce tool ÉCRIT dans Comptaweb. Ne l'utilise PAS pour catégoriser ou corriger une écriture/brouillon",
      "qui existe déjà côté Baloo — ça créerait un DOUBLON dans CW. Pour éditer un brouillon (nature, unité,",
      "activité, mode, montant…), utilise update_ecriture, qui reste local tant que l'écriture n'est pas dans CW.",
      "Si CW indisponible, l'écriture reste en draft, à valider manuellement plus tard.",
      "Accepte le montant en cents (champ amount_cents) OU en chaîne formatée FR (champ montant).",
    ].join(' '),
    {
      date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date (YYYY-MM-DD)'),
      description: z.string().min(1),
      amount_cents: z.number().int().optional(),
      montant: z
        .string()
        .optional()
        .describe('Alternative à amount_cents : montant formaté FR (ex: "42,50").'),
      type: z.enum(['depense', 'recette']),
      unite_id: z.string().optional(),
      category_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      activite_id: z.string().optional(),
      numero_piece: z.string().optional(),
      carte_id: z.string().optional(),
      justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      let amount_cents: number;
      if (typeof params.amount_cents === 'number') {
        amount_cents = params.amount_cents;
      } else if (params.montant) {
        amount_cents = parseAmount(params.montant);
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Erreur : montant manquant (passe amount_cents ou montant).',
            },
          ],
        };
      }

      const payload: EcriturePayload = {
        date_ecriture: params.date_ecriture,
        description: params.description,
        amount_cents,
        type: params.type,
        unite_id: params.unite_id ?? null,
        category_id: params.category_id ?? null,
        mode_paiement_id: params.mode_paiement_id ?? null,
        activite_id: params.activite_id ?? null,
        numero_piece: params.numero_piece ?? null,
        carte_id: params.carte_id ?? null,
        justif_attendu: params.justif_attendu,
        notes: params.notes ?? null,
      };

      try {
        const result = await createEcritureAndPushToCw(getDb(), {
          payload,
          group_id: ctx.groupId,
          cwScraper: defaultCwScraper,
          cwConfigLoader: loadConfig,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  ecriture: result,
                  message: `Écriture ${result.id} créée (status=${result.status}, cw_numero_piece=${result.cw_numero_piece}).`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof CwPushFailedError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    ok: false,
                    error: 'cw_write_failed',
                    message: err.message,
                    fallback_status: 'draft',
                    ecriture_id: err.ecritureId,
                    hint:
                      "L'écriture est conservée en draft dans Baloo. Tu peux retry plus tard, " +
                      'ou utiliser la fonction "Tout copier" côté UI pour saisir manuellement dans Comptaweb.',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        if (err instanceof CwLocalUpdateFailedError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    ok: false,
                    error: 'cw_synced_but_local_update_failed',
                    message: err.message,
                    cw_numero_piece: err.cwNumeroPiece,
                    ecriture_id: err.ecritureId,
                    hint:
                      "CW a la donnée mais Baloo n'a pas pu enregistrer l'état pending_sync. " +
                      'La sync incrémentale Phase 2 ramassera la pièce par cw_numero_piece. ' +
                      'Ne PAS retry (créerait un doublon CW).',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, error: 'internal_error', message }, null, 2),
            },
          ],
        };
      }
    },
  );

  // ─── update_ecriture ──────────────────────────────────────────────────
  //
  // Édition d'une écriture EXISTANTE. On expose les champs d'imputation
  // (category_id, unite_id, activite_id, mode_paiement_id, carte_id, date,
  // montant, libellé, type, numero_piece) EN PLUS des champs Baloo-only
  // (notes, justif_attendu). C'est délégué au service `updateEcriture`, qui
  // applique le verrou miroir : tant que l'écriture est un brouillon (status
  // non mirror), tout est modifiable sans toucher Comptaweb ; une fois dans
  // CW (mirror/divergent), les champs miroir sont silencieusement ignorés et
  // seuls notes/justif_attendu passent. `status`/`comptaweb_synced` restent
  // NON exposés (réservés aux flux internes de sync).
  //
  // Régression historique corrigée : la whitelist ne portait QUE sur
  // notes+justif_attendu, rendant impossible la catégorisation d'un draft
  // via MCP — un agent sommé de « catégoriser » se rabattait sur
  // create_ecriture (push CW) et créait des doublons. Cf. create_ecriture.
  server.tool(
    'update_ecriture',
    [
      "Met à jour une écriture EXISTANTE. À utiliser pour catégoriser / imputer / corriger un brouillon (draft) :",
      'tant que l\'écriture n\'est pas dans Comptaweb, tous les champs (nature/catégorie, unité, activité, mode de paiement,',
      'carte, date, montant, libellé, type, n° pièce) sont modifiables — un simple UPDATE local, AUCUN envoi vers Comptaweb.',
      "Ne crée RIEN : pour une écriture neuve destinée à CW, utilise create_ecriture, pas ce tool.",
      'Une fois l\'écriture dans Comptaweb (mirror/divergent), ces champs deviennent la source de vérité Comptaweb et sont',
      'silencieusement ignorés ici ; seuls notes et justif_attendu (champs Baloo-only) restent modifiables. Pour corriger',
      'une écriture déjà dans CW, modifie côté Comptaweb et la sync Baloo reflétera.',
    ].join(' '),
    {
      id: z.string().describe('ID de l\'écriture (ex: DEP-2026-001 ou REC-2026-005)'),
      // Champs d'imputation : appliqués SEULEMENT si l'écriture est un brouillon
      // (status non mirror) — le service updateEcriture les ignore en mirror.
      category_id: z.string().optional().describe('Nature / catégorie comptable (cf. list_categories).'),
      unite_id: z.string().optional(),
      activite_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      carte_id: z.string().optional(),
      numero_piece: z.string().optional(),
      date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date (YYYY-MM-DD)'),
      description: z.string().min(1).optional(),
      amount_cents: z.number().int().optional(),
      montant: z.string().optional().describe('Alternative à amount_cents : montant formaté FR (ex: "42,50").'),
      type: z.enum(['depense', 'recette']).optional(),
      // Champs Baloo-only : modifiables quel que soit le statut.
      notes: z.string().nullable().optional(),
      justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    },
    async (params) => {
      const { id, montant, ...rest } = params;
      const patch: Parameters<typeof updateEcriture>[2] = { ...rest };
      // `montant` (FR) est un alias d'amount_cents ; on ne convertit que si
      // amount_cents n'a pas été fourni explicitement.
      if (patch.amount_cents === undefined && montant) {
        patch.amount_cents = parseAmount(montant);
      }
      const updated = await updateEcriture(ecritureCtx, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Écriture ${id} introuvable.` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                ecriture: {
                  id: updated.id,
                  status: updated.status as EcritureStatus,
                  category_id: updated.category_id,
                  unite_id: updated.unite_id,
                  activite_id: updated.activite_id,
                  mode_paiement_id: updated.mode_paiement_id,
                  carte_id: updated.carte_id,
                  notes: updated.notes,
                  justif_attendu: updated.justif_attendu,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
