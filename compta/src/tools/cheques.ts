import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount, parseAmount } from '../utils.js';

interface DepotChequesRow {
  id: string;
  total_amount_cents: number;
  detail_cheques: string | null;
  [key: string]: unknown;
}

export function registerChequesTools(server: McpServer) {
  server.tool(
    'list_depots_cheques',
    'Liste les dépôts de chèques (banque et ANCV)',
    {
      type_depot: z.enum(['banque', 'ancv']).optional(),
      confirmation_status: z.enum(['en_attente', 'confirme']).optional(),
      limit: z.number().default(50),
    },
    async (params) => {
      const rows = await api.get<DepotChequesRow[]>('/api/cheques', params);
      const result = rows.map((r) => ({
        ...r,
        total: formatAmount(r.total_amount_cents),
        detail_cheques: r.detail_cheques ? JSON.parse(r.detail_cheques) : null,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_depot_cheques',
    'Enregistre un dépôt de chèques (banque ou ANCV)',
    {
      date_depot: z.string().describe('Date du dépôt (YYYY-MM-DD)'),
      type_depot: z.enum(['banque', 'ancv']).describe('Type : banque ou ANCV'),
      cheques: z
        .array(
          z.object({
            emetteur: z.string().describe("Nom de l'émetteur"),
            montant: z.string().describe('Montant du chèque (ex: "50,00")'),
            numero: z.string().optional().describe('Numéro du chèque'),
          }),
        )
        .describe('Liste des chèques déposés'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<DepotChequesRow>('/api/cheques', {
        date_depot: params.date_depot,
        type_depot: params.type_depot,
        cheques: params.cheques.map((c) => ({
          emetteur: c.emetteur,
          amount_cents: parseAmount(c.montant),
          numero: c.numero ?? null,
        })),
        notes: params.notes ?? null,
      });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...created, total: formatAmount(created.total_amount_cents) }, null, 2) },
        ],
      };
    },
  );
}
