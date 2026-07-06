import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listMouvementsCaisse, createMouvementCaisse } from '@/lib/services/caisse';
import {
  syncCaisseFromComptaweb,
  discoverCaisses,
  resolveCaisseId,
} from '@/lib/services/caisse-sync';
import { formatAmount, parseAmount } from '@/lib/format';

export function registerCaisseTools(server: McpServer, ctx: McpContext) {
  const caisseCtx = { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds ?? null };

  server.tool(
    'list_mouvements_caisse',
    'Liste les mouvements de caisse (espèces) avec solde courant.',
    {
      limit: z.number().int().min(1).max(500).default(50),
      unite_id: z.string().optional(),
      activite_id: z.string().optional(),
    },
    async (params) => {
      const data = await listMouvementsCaisse(caisseCtx, params);
      const result = {
        solde_caisse: formatAmount(data.solde),
        mouvements: data.mouvements.map((m) => ({
          ...m,
          montant: formatAmount(m.amount_cents),
          solde_apres:
            m.solde_apres_cents != null ? formatAmount(m.solde_apres_cents) : null,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'cw_list_caisses',
    'Liste les caisses du groupe côté Comptaweb (utile pour récupérer caisseId à passer à cw_sync_caisse).',
    {},
    async () => {
      const caisses = await discoverCaisses();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ caisses }, null, 2) }] };
    },
  );

  server.tool(
    'cw_sync_caisse',
    "Synchronise les mouvements de caisse depuis Comptaweb vers Baloo (pull). Idempotent : ne crée pas de doublon (matching par comptaweb_ecriture_id, fallback numero_piece+date+montant). Si caisse_id est omis, prend la première caisse active.",
    {
      caisse_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('ID de la caisse Comptaweb (cf. cw_list_caisses).'),
    },
    async (params) => {
      const caisseId = params.caisse_id ?? (await resolveCaisseId());
      const data = await syncCaisseFromComptaweb(ctx.groupId, caisseId);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...data,
                solde_comptaweb: formatAmount(data.soldeComptaweb),
                solde_baloo: formatAmount(data.soldeBaloo),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // create_mouvement_caisse reste une saisie locale Baloo-only : la spec
  // miroir strict acte qu'on n'écrit PAS dans la caisse CW (pas de
  // scraping write caisse aujourd'hui). Le mouvement crée la ligne en
  // BDD ; le sync CW remontera quand l'écriture sera saisie côté CW.
  server.tool(
    'create_mouvement_caisse',
    "Enregistre un mouvement de caisse (entrée ou sortie d'espèces). Saisie locale Baloo-only : aucun write côté Comptaweb (cf. spec miroir strict).",
    {
      date_mouvement: z.string().describe('Date du mouvement (YYYY-MM-DD)'),
      description: z.string().describe('Description'),
      montant: z.string().describe('Montant signé : "+15,00" pour entrée, "-8,50" pour sortie'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createMouvementCaisse(caisseCtx, {
        date_mouvement: params.date_mouvement,
        description: params.description,
        amount_cents: parseAmount(params.montant),
        notes: params.notes ?? null,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...created,
                montant: formatAmount(created.amount_cents),
                solde_apres:
                  created.solde_apres_cents != null
                    ? formatAmount(created.solde_apres_cents)
                    : null,
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
