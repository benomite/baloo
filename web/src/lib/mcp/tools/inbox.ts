import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listInboxItems,
  findSuggestionsForEcriture,
  findSuggestionsForDepot,
  INBOX_PERIODS,
} from '@/lib/queries/inbox';
import { attachDepotToEcriture } from '@/lib/services/depots';
import { applyAutoLinks } from '@/lib/services/inbox-auto';

const PERIOD_ENUM = z.enum(INBOX_PERIODS);

export function registerInboxTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'inbox_list_orphan_ecritures',
    'Liste les écritures dépenses (et optionnellement recettes) sans justificatif attaché.',
    {
      period: PERIOD_ENUM.optional().describe('Fenêtre de date_ecriture (défaut: 90j)'),
      recettes: z.boolean().optional().describe('Inclure aussi les recettes orphelines (défaut: false)'),
    },
    async (params) => {
      const data = await listInboxItems({
        period: params.period ?? '90j',
        includeRecettes: !!params.recettes,
        groupId: ctx.groupId,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                period: params.period ?? '90j',
                include_recettes: !!params.recettes,
                count: data.ecrituresOrphelines.length,
                truncated: data.ecrituresTruncated > 0,
                ecritures: data.ecrituresOrphelines,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'inbox_list_orphan_justifs',
    'Liste les dépôts de justificatifs en attente (statut a_traiter).',
    {},
    async () => {
      const data = await listInboxItems({
        period: 'tout',
        includeRecettes: true,
        groupId: ctx.groupId,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { count: data.justifsOrphelins.length, depots: data.justifsOrphelins },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'inbox_suggest_matches',
    "Suggestions lenient (montant ±2%, date ±3j) pour une écriture ou un dépôt orphelin. Fournir EXACTEMENT un des deux paramètres.",
    {
      ecriture_id: z.string().optional(),
      depot_id: z.string().optional(),
    },
    async (params) => {
      if (!!params.ecriture_id === !!params.depot_id) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Erreur : fournir exactement un de ecriture_id ou depot_id.',
            },
          ],
        };
      }
      if (params.ecriture_id) {
        const matches = await findSuggestionsForEcriture({ groupId: ctx.groupId }, params.ecriture_id);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ecriture_id: params.ecriture_id, matches }, null, 2),
            },
          ],
        };
      }
      const matches = await findSuggestionsForDepot({ groupId: ctx.groupId }, params.depot_id!);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ depot_id: params.depot_id, matches }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'inbox_link',
    'Lie une écriture et un dépôt orphelin (équivalent du bouton Lier dans /inbox).',
    {
      ecriture_id: z.string(),
      depot_id: z.string(),
    },
    async (params) => {
      try {
        const depot = await attachDepotToEcriture(
          { groupId: ctx.groupId },
          params.depot_id,
          params.ecriture_id,
        );
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, depot }, null, 2) },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: false, error: msg }, null, 2) },
          ],
        };
      }
    },
  );

  server.tool(
    'inbox_auto_match',
    'Déclenche le matching auto strict (montant exact, date ±1j, unicité symétrique). Idempotent.',
    {},
    async () => {
      const result = await applyAutoLinks(ctx.groupId);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ linked: result.pairs, rejected_ambiguous: [] }, null, 2),
          },
        ],
      };
    },
  );
}
