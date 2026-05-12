import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

export function registerInboxTools(server: McpServer) {
  server.tool(
    'inbox_list_orphan_ecritures',
    "Liste les écritures dépenses (et optionnellement recettes) sans justificatif attaché",
    {
      period: z
        .enum(['30j', '90j', '6mois', 'tout'])
        .optional()
        .describe('Fenêtre de date_ecriture (défaut: 90j)'),
      recettes: z.boolean().optional().describe('Inclure aussi les recettes orphelines (défaut: false)'),
    },
    async (params) => {
      const query: Record<string, unknown> = {};
      if (params.period) query.period = params.period;
      if (params.recettes) query.recettes = '1';
      const data = await api.get('/api/inbox/orphan-ecritures', query);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_list_orphan_justifs',
    'Liste les dépôts de justificatifs en attente (statut a_traiter)',
    {},
    async () => {
      const data = await api.get('/api/inbox/orphan-justifs');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
            { type: 'text', text: 'Erreur : fournir exactement un de ecriture_id ou depot_id.' },
          ],
        };
      }
      const query: Record<string, unknown> = {};
      if (params.ecriture_id) query.ecriture_id = params.ecriture_id;
      if (params.depot_id) query.depot_id = params.depot_id;
      const data = await api.get('/api/inbox/suggestions', query);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_link',
    'Lie une écriture et un dépôt orphelin (équivalent du bouton Lier dans /inbox)',
    {
      ecriture_id: z.string(),
      depot_id: z.string(),
    },
    async (params) => {
      const data = await api.post('/api/inbox/link', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'inbox_auto_match',
    "Déclenche le matching auto strict (montant exact, date ±1j, unicité symétrique). Idempotent.",
    {},
    async () => {
      const data = await api.post('/api/inbox/auto-match', {});
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
