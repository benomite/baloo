import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, formatAmount } from '../db.js';

export function registerOverviewTools(server: McpServer) {
  server.tool(
    'vue_ensemble',
    'Vue d\'ensemble de la trésorerie : soldes, répartition par unité, remboursements en attente, alertes',
    { saison: z.string().optional().describe('Filtre par saison (ex: "2025-2026"). Par défaut: saison courante') },
    ({ saison }) => {
      const db = getDb();

      const depenses = db.prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures WHERE type = ?'
      ).get('depense') as { total: number };

      const recettes = db.prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures WHERE type = ?'
      ).get('recette') as { total: number };

      const parUnite = db.prepare(`
        SELECT u.code, u.name,
          COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
          COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
        FROM unites u
        LEFT JOIN ecritures e ON e.unite_id = u.id
        GROUP BY u.id ORDER BY u.code
      `).all() as { code: string; name: string; depenses: number; recettes: number }[];

      const rbtEnAttente = db.prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total FROM remboursements WHERE status IN ('demande', 'valide')"
      ).get() as { count: number; total: number };

      const rbtRecents = db.prepare(
        "SELECT id, demandeur, amount_cents, status, date_depense FROM remboursements ORDER BY created_at DESC LIMIT 5"
      ).all() as { id: string; demandeur: string; amount_cents: number; status: string; date_depense: string }[];

      const ecrituresSansJustif = db.prepare(`
        SELECT COUNT(*) as count FROM ecritures e
        WHERE e.type = 'depense'
        AND e.justif_attendu = 1
        AND NOT EXISTS (SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
      `).get() as { count: number };

      const dernierImport = db.prepare(
        'SELECT import_date, source_file, total_depenses_cents, total_recettes_cents FROM comptaweb_imports ORDER BY import_date DESC LIMIT 1'
      ).get() as { import_date: string; source_file: string; total_depenses_cents: number; total_recettes_cents: number } | undefined;

      const result = {
        solde_global: {
          total_depenses: formatAmount(depenses.total),
          total_recettes: formatAmount(recettes.total),
          solde: formatAmount(recettes.total - depenses.total),
          depenses_cents: depenses.total,
          recettes_cents: recettes.total,
        },
        par_unite: parUnite.map(u => ({
          code: u.code,
          name: u.name,
          depenses: formatAmount(u.depenses),
          recettes: formatAmount(u.recettes),
          solde: formatAmount(u.recettes - u.depenses),
        })),
        remboursements_en_attente: {
          count: rbtEnAttente.count,
          total: formatAmount(rbtEnAttente.total),
          recents: rbtRecents.map(r => ({
            id: r.id,
            demandeur: r.demandeur,
            montant: formatAmount(r.amount_cents),
            status: r.status,
            date_depense: r.date_depense,
          })),
        },
        alertes: {
          depenses_sans_justificatif: ecrituresSansJustif.count,
        },
        dernier_import_comptaweb: dernierImport ? {
          date: dernierImport.import_date,
          fichier: dernierImport.source_file,
          depenses: formatAmount(dernierImport.total_depenses_cents),
          recettes: formatAmount(dernierImport.total_recettes_cents),
        } : null,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
