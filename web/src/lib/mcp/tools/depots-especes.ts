import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listDepotsEspeces,
  attachDepotEspecesToEcriture,
} from '@/lib/services/depots-especes';
import { createDepotEspecesAvecMouvement } from '@/lib/services/caisse';
import { formatAmount, parseAmount } from '@/lib/format';

export function registerDepotsEspecesTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_depots_especes',
    "Liste les dépôts d'espèces (caisse → banque) avec statut de rapprochement.",
    {
      pending_only: z.boolean().optional().describe('Si true, ne retourne que les dépôts non rapprochés'),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (params) => {
      const rows = await listDepotsEspeces({ groupId: ctx.groupId }, params);
      const result = rows.map((r) => ({
        ...r,
        total: formatAmount(r.total_amount_cents),
        rapproche: r.ecriture_id != null,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_depot_especes',
    "Enregistre un dépôt d'espèces de la caisse vers le compte banque (crée le dépôt et le mouvement caisse négatif lié).",
    {
      date_depot: z.string().describe('Date du dépôt (YYYY-MM-DD)'),
      montant: z.string().describe('Montant total déposé (ex: "250,00")'),
      description: z.string().optional().describe('Libellé du mouvement caisse (défaut : "Dépôt en banque <date>")'),
      detail_billets: z.string().optional().describe('Détail libre des billets/pièces déposés'),
      notes: z.string().optional(),
    },
    async (params) => {
      const result = await createDepotEspecesAvecMouvement(
        { groupId: ctx.groupId },
        {
          date_depot: params.date_depot,
          total_amount_cents: parseAmount(params.montant),
          description: params.description ?? null,
          detail_billets: params.detail_billets ?? null,
          notes: params.notes ?? null,
        },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                depot: {
                  ...result.depot,
                  total: formatAmount(result.depot.total_amount_cents),
                },
                mouvement: {
                  ...result.mouvement,
                  montant: formatAmount(result.mouvement.amount_cents),
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

  server.tool(
    'rapprocher_depot_especes',
    "Lie un dépôt d'espèces à l'écriture banque correspondante (versement espèces sur compte courant). Marque les mouvements caisse liés comme 'rapproche'.",
    {
      depot_id: z.string().describe('ID du dépôt espèces (DES-XXX)'),
      ecriture_id: z.string().describe("ID de l'écriture banque (DEP-XXX ou REC-XXX)"),
    },
    async (params) => {
      const updated = await attachDepotEspecesToEcriture(
        { groupId: ctx.groupId },
        params.depot_id,
        params.ecriture_id,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ...updated, total: formatAmount(updated.total_amount_cents) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
