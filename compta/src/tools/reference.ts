import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db.js';

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : la logique métier de cet
// outil sera retirée au chantier 3 et remplacée par un appel HTTP à
// `web/src/lib/services/reference.ts` (canonique). En attendant, on conserve
// l'implémentation directe pour ne rien casser côté trésorier.
export function registerReferenceTools(server: McpServer) {
  server.tool('list_categories', 'Liste toutes les catégories de dépense/recette', {}, () => {
    const rows = getDb().prepare('SELECT id, name, type, comptaweb_nature FROM categories ORDER BY name').all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.tool('list_unites', 'Liste toutes les unités du groupe', {}, () => {
    const rows = getDb().prepare('SELECT id, code, name FROM unites ORDER BY code').all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.tool('list_modes_paiement', 'Liste tous les modes de paiement', {}, () => {
    const rows = getDb().prepare('SELECT id, name FROM modes_paiement ORDER BY name').all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.tool('list_activites', 'Liste toutes les activités (ventilation)', {}, () => {
    const rows = getDb().prepare('SELECT id, name FROM activites ORDER BY name').all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });
}
