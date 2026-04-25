import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../api-client.js';

export function registerReferenceTools(server: McpServer) {
  server.tool('list_categories', 'Liste toutes les catégories de dépense/recette', {}, async () => {
    const rows = await api.get<unknown[]>('/api/reference/categories');
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.tool('list_unites', 'Liste toutes les unités du groupe', {}, async () => {
    const rows = await api.get<unknown[]>('/api/reference/unites');
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.tool('list_modes_paiement', 'Liste tous les modes de paiement', {}, async () => {
    const rows = await api.get<unknown[]>('/api/reference/modes-paiement');
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.tool('list_activites', 'Liste toutes les activités (ventilation)', {}, async () => {
    const rows = await api.get<unknown[]>('/api/reference/activites');
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });
}
