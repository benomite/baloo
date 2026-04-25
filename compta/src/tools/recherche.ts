import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, formatAmount } from '../db.js';

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : la logique métier de cet
// outil sera retirée au chantier 3 et remplacée par un appel HTTP à
// `web/src/lib/services/recherche.ts` (canonique). En attendant, on conserve
// l'implémentation directe pour ne rien casser côté trésorier.
export function registerRechercheTools(server: McpServer) {
  server.tool(
    'recherche',
    'Recherche libre dans toutes les tables (écritures, remboursements, abandons, caisse, chèques)',
    {
      query: z.string().describe('Texte à rechercher'),
      tables: z.array(z.enum(['ecritures', 'remboursements', 'abandons', 'caisse', 'cheques'])).optional()
        .describe('Tables dans lesquelles chercher (par défaut: toutes)'),
      limit: z.number().default(10).describe('Nombre max de résultats par table'),
    },
    (params) => {
      const db = getDb();
      const q = `%${params.query}%`;
      const tables = params.tables ?? ['ecritures', 'remboursements', 'abandons', 'caisse', 'cheques'];
      const results: Record<string, unknown[]> = {};

      if (tables.includes('ecritures')) {
        results.ecritures = db.prepare(`
          SELECT id, date_ecriture, description, amount_cents, type, status, notes
          FROM ecritures WHERE description LIKE ? OR notes LIKE ? OR id LIKE ?
          ORDER BY date_ecriture DESC LIMIT ?
        `).all(q, q, q, params.limit).map((r: any) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      }

      if (tables.includes('remboursements')) {
        results.remboursements = db.prepare(`
          SELECT id, demandeur, amount_cents, date_depense, nature, status, notes
          FROM remboursements WHERE demandeur LIKE ? OR nature LIKE ? OR notes LIKE ? OR id LIKE ?
          ORDER BY created_at DESC LIMIT ?
        `).all(q, q, q, q, params.limit).map((r: any) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      }

      if (tables.includes('abandons')) {
        results.abandons = db.prepare(`
          SELECT id, donateur, amount_cents, date_depense, nature, notes
          FROM abandons_frais WHERE donateur LIKE ? OR nature LIKE ? OR notes LIKE ? OR id LIKE ?
          ORDER BY created_at DESC LIMIT ?
        `).all(q, q, q, q, params.limit).map((r: any) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      }

      if (tables.includes('caisse')) {
        results.caisse = db.prepare(`
          SELECT id, date_mouvement, description, amount_cents, notes
          FROM mouvements_caisse WHERE description LIKE ? OR notes LIKE ? OR id LIKE ?
          ORDER BY date_mouvement DESC LIMIT ?
        `).all(q, q, q, params.limit).map((r: any) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      }

      if (tables.includes('cheques')) {
        results.cheques = db.prepare(`
          SELECT id, date_depot, type_depot, total_amount_cents, nombre_cheques, notes
          FROM depots_cheques WHERE notes LIKE ? OR detail_cheques LIKE ? OR id LIKE ?
          ORDER BY date_depot DESC LIMIT ?
        `).all(q, q, q, params.limit).map((r: any) => ({ ...r, total: formatAmount(r.total_amount_cents) }));
      }

      const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

      return { content: [{ type: 'text', text: JSON.stringify({ query: params.query, total_resultats: totalResults, resultats: results }, null, 2) }] };
    }
  );
}
