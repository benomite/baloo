import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount, parseAmount } from '../utils.js';

interface MouvementCaisseRow {
  id: string;
  amount_cents: number;
  solde_apres_cents: number | null;
  [key: string]: unknown;
}

interface ListMouvementsResponse {
  mouvements: MouvementCaisseRow[];
  solde: number;
}

export function registerCaisseTools(server: McpServer) {
  server.tool(
    'list_mouvements_caisse',
    'Liste les mouvements de caisse (espèces) avec solde courant',
    { limit: z.number().default(50) },
    async (params) => {
      const data = await api.get<ListMouvementsResponse>('/api/caisse', params);
      const result = {
        solde_caisse: formatAmount(data.solde),
        mouvements: data.mouvements.map((m) => ({
          ...m,
          montant: formatAmount(m.amount_cents),
          solde_apres: m.solde_apres_cents != null ? formatAmount(m.solde_apres_cents) : null,
        })),
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_mouvement_caisse',
    "Enregistre un mouvement de caisse (entrée ou sortie d'espèces)",
    {
      date_mouvement: z.string().describe('Date du mouvement (YYYY-MM-DD)'),
      description: z.string().describe('Description'),
      montant: z.string().describe('Montant signé : "+15,00" pour entrée, "-8,50" pour sortie'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<MouvementCaisseRow>('/api/caisse', {
        date_mouvement: params.date_mouvement,
        description: params.description,
        amount_cents: parseAmount(params.montant),
        notes: params.notes ?? null,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...created,
                montant: formatAmount(created.amount_cents),
                solde_apres: created.solde_apres_cents != null ? formatAmount(created.solde_apres_cents) : null,
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
