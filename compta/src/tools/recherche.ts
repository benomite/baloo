import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount } from '../utils.js';

type Table = 'ecritures' | 'remboursements' | 'abandons' | 'caisse' | 'cheques';

interface RechercheResponse {
  query: string;
  total: number;
  resultats: Partial<Record<Table, Record<string, unknown>[]>>;
}

export function registerRechercheTools(server: McpServer) {
  server.tool(
    'recherche',
    'Recherche libre dans toutes les tables (écritures, remboursements, abandons, caisse, chèques)',
    {
      query: z.string().describe('Texte à rechercher'),
      tables: z
        .array(z.enum(['ecritures', 'remboursements', 'abandons', 'caisse', 'cheques']))
        .optional()
        .describe('Tables dans lesquelles chercher (par défaut: toutes)'),
      limit: z.number().default(10).describe('Nombre max de résultats par table'),
    },
    async (params) => {
      const data = await api.post<RechercheResponse>('/api/recherche', {
        query: params.query,
        tables: params.tables,
        limit: params.limit,
      });

      // Formate les montants pour la lisibilité Claude Code.
      const annotated: Partial<Record<Table, Record<string, unknown>[]>> = {};
      for (const [table, rows] of Object.entries(data.resultats) as [Table, Record<string, unknown>[]][]) {
        annotated[table] = rows.map((r) => {
          if (table === 'cheques' && typeof r.total_amount_cents === 'number') {
            return { ...r, total: formatAmount(r.total_amount_cents) };
          }
          if (typeof r.amount_cents === 'number') {
            return { ...r, montant: formatAmount(r.amount_cents) };
          }
          return r;
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { query: data.query, total_resultats: data.total, resultats: annotated },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
