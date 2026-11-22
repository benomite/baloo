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
    "Synchronise les mouvements de caisse depuis Comptaweb vers Baloo (pull). sync_run le fait déjà à chaque cycle : cet outil sert à cibler une autre caisse (caisse_id). Idempotent : ne crée pas de doublon (matching par comptaweb_ecriture_id, fallback numero_piece+date+montant). Si caisse_id est omis, prend la première caisse active.",
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

  // create_mouvement_caisse crée un BROUILLON destiné à Comptaweb (#61),
  // comme un brouillon bancaire : il part dans la caisse CW via
  // push_mouvement_caisse_comptaweb, puis sync_run le reconnaît comme la
  // ligne CW (cf. services/caisse-comptaweb).
  server.tool(
    'create_mouvement_caisse',
    "Crée un brouillon de mouvement de caisse (entrée ou sortie d'espèces) destiné à Comptaweb, statut 'draft'. Comme un brouillon bancaire, il doit porter nature (category_id), unité et activité pour être envoyé : compléter via update_mouvement_caisse, prévisualiser puis envoyer via push_mouvement_caisse_comptaweb. Le sync_run suivant le reconnaît comme la ligne de caisse Comptaweb.",
    {
      date_mouvement: z.string().describe('Date du mouvement (YYYY-MM-DD)'),
      description: z.string().describe('Description'),
      montant: z.string().describe('Montant signé : "+15,00" pour entrée, "-8,50" pour sortie'),
      category_id: z.string().optional().describe('Nature (cf. list_categories)'),
      unite_id: z.string().optional().describe('Unité (cf. list_unites)'),
      activite_id: z.string().optional().describe('Activité (cf. list_activites)'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createMouvementCaisse(caisseCtx, {
        date_mouvement: params.date_mouvement,
        description: params.description,
        amount_cents: parseAmount(params.montant),
        status: 'draft',
        category_id: params.category_id ?? null,
        unite_id: params.unite_id ?? null,
        activite_id: params.activite_id ?? null,
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
