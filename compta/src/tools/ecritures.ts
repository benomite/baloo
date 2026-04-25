import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, formatAmount, parseAmount, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : la logique métier de cet
// outil sera retirée au chantier 3 et remplacée par un appel HTTP à
// `web/src/lib/services/ecritures.ts` (canonique). En attendant, on conserve
// l'implémentation directe pour ne rien casser côté trésorier.
export function registerEcritureTools(server: McpServer) {
  server.tool(
    'list_ecritures',
    'Liste les écritures (dépenses/recettes) avec filtres optionnels',
    {
      unite_id: z.string().optional().describe('Filtrer par unité (ex: u-lj)'),
      category_id: z.string().optional().describe('Filtrer par catégorie (ex: cat-intendance)'),
      type: z.enum(['depense', 'recette']).optional().describe('Filtrer par type'),
      date_debut: z.string().optional().describe('Date début (YYYY-MM-DD)'),
      date_fin: z.string().optional().describe('Date fin (YYYY-MM-DD)'),
      mode_paiement_id: z.string().optional().describe('Filtrer par mode de paiement'),
      status: z.enum(['brouillon', 'valide', 'saisie_comptaweb']).optional(),
      search: z.string().optional().describe('Recherche dans description et notes'),
      limit: z.number().default(50).describe('Nombre max de résultats'),
      offset: z.number().default(0),
    },
    (params) => {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (params.unite_id) { conditions.push('e.unite_id = ?'); values.push(params.unite_id); }
      if (params.category_id) { conditions.push('e.category_id = ?'); values.push(params.category_id); }
      if (params.type) { conditions.push('e.type = ?'); values.push(params.type); }
      if (params.date_debut) { conditions.push('e.date_ecriture >= ?'); values.push(params.date_debut); }
      if (params.date_fin) { conditions.push('e.date_ecriture <= ?'); values.push(params.date_fin); }
      if (params.mode_paiement_id) { conditions.push('e.mode_paiement_id = ?'); values.push(params.mode_paiement_id); }
      if (params.status) { conditions.push('e.status = ?'); values.push(params.status); }
      if (params.search) { conditions.push("(e.description LIKE ? OR e.notes LIKE ?)"); values.push(`%${params.search}%`, `%${params.search}%`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(params.limit, params.offset);

      const rows = getDb().prepare(`
        SELECT e.*, u.code as unite_code, c.name as category_name, m.name as mode_paiement_name, a.name as activite_name
        FROM ecritures e
        LEFT JOIN unites u ON u.id = e.unite_id
        LEFT JOIN categories c ON c.id = e.category_id
        LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
        LEFT JOIN activites a ON a.id = e.activite_id
        ${where}
        ORDER BY e.date_ecriture DESC, e.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...values) as Record<string, unknown>[];

      const count = getDb().prepare(
        `SELECT COUNT(*) as total FROM ecritures e ${where}`
      ).get(...values.slice(0, -2)) as { total: number };

      const result = rows.map((r: Record<string, unknown>) => ({
        ...r,
        montant: formatAmount(r.amount_cents as number),
      }));

      return { content: [{ type: 'text', text: JSON.stringify({ total: count.total, ecritures: result }, null, 2) }] };
    }
  );

  server.tool(
    'create_ecriture',
    'Crée une nouvelle écriture (dépense ou recette)',
    {
      date_ecriture: z.string().describe('Date de l\'écriture (YYYY-MM-DD)'),
      description: z.string().describe('Description de l\'opération'),
      montant: z.string().describe('Montant (ex: "42,50" ou "42.50")'),
      type: z.enum(['depense', 'recette']).describe('Type : dépense ou recette'),
      unite_id: z.string().optional().describe('Unité concernée (ex: u-lj)'),
      category_id: z.string().optional().describe('Catégorie (ex: cat-intendance)'),
      mode_paiement_id: z.string().optional().describe('Mode de paiement (ex: mp-cb-sgdf)'),
      activite_id: z.string().optional().describe('Activité (ex: act-annee)'),
      numero_piece: z.string().optional().describe('Numéro de pièce'),
      notes: z.string().optional(),
    },
    (params) => {
      const prefix = params.type === 'depense' ? 'DEP' : 'REC';
      const id = nextId(prefix);
      const cents = parseAmount(params.montant);
      const now = currentTimestamp();

      const { groupId } = getCurrentContext();
      getDb().prepare(`
        INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, unite_id, category_id, mode_paiement_id, activite_id, numero_piece, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, groupId, params.date_ecriture, params.description, cents, params.type, params.unite_id ?? null, params.category_id ?? null, params.mode_paiement_id ?? null, params.activite_id ?? null, params.numero_piece ?? null, params.notes ?? null, now, now);

      const row = getDb().prepare('SELECT * FROM ecritures WHERE id = ?').get(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ...row as object, montant: formatAmount(cents) }, null, 2) }] };
    }
  );

  server.tool(
    'update_ecriture',
    'Met à jour une écriture existante (statut, notes, catégorie, etc.)',
    {
      id: z.string().describe('ID de l\'écriture (ex: DEP-2026-001)'),
      description: z.string().optional(),
      montant: z.string().optional().describe('Nouveau montant (ex: "42,50")'),
      unite_id: z.string().optional(),
      category_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      activite_id: z.string().optional(),
      numero_piece: z.string().optional(),
      status: z.enum(['brouillon', 'valide', 'saisie_comptaweb']).optional(),
      comptaweb_synced: z.boolean().optional(),
      notes: z.string().optional(),
    },
    (params) => {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (params.description !== undefined) { sets.push('description = ?'); values.push(params.description); }
      if (params.montant !== undefined) { sets.push('amount_cents = ?'); values.push(parseAmount(params.montant)); }
      if (params.unite_id !== undefined) { sets.push('unite_id = ?'); values.push(params.unite_id); }
      if (params.category_id !== undefined) { sets.push('category_id = ?'); values.push(params.category_id); }
      if (params.mode_paiement_id !== undefined) { sets.push('mode_paiement_id = ?'); values.push(params.mode_paiement_id); }
      if (params.activite_id !== undefined) { sets.push('activite_id = ?'); values.push(params.activite_id); }
      if (params.numero_piece !== undefined) { sets.push('numero_piece = ?'); values.push(params.numero_piece); }
      if (params.status !== undefined) { sets.push('status = ?'); values.push(params.status); }
      if (params.comptaweb_synced !== undefined) { sets.push('comptaweb_synced = ?'); values.push(params.comptaweb_synced ? 1 : 0); }
      if (params.notes !== undefined) { sets.push('notes = ?'); values.push(params.notes); }

      if (sets.length === 0) {
        return { content: [{ type: 'text', text: 'Aucun champ à mettre à jour.' }] };
      }

      sets.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(params.id);

      const result = getDb().prepare(`UPDATE ecritures SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (result.changes === 0) {
        return { content: [{ type: 'text', text: `Écriture ${params.id} non trouvée.` }] };
      }

      const row = getDb().prepare('SELECT * FROM ecritures WHERE id = ?').get(params.id);
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    }
  );
}
