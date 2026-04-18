import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, formatAmount, parseAmount, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';

export function registerRemboursementTools(server: McpServer) {
  server.tool(
    'list_remboursements',
    'Liste les demandes de remboursement avec filtres optionnels',
    {
      status: z.enum(['demande', 'valide', 'paye', 'refuse']).optional(),
      unite_id: z.string().optional(),
      demandeur: z.string().optional().describe('Filtrer par nom du demandeur (recherche partielle)'),
      search: z.string().optional().describe('Recherche dans demandeur, nature et notes'),
      limit: z.number().default(50),
    },
    (params) => {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (params.status) { conditions.push('r.status = ?'); values.push(params.status); }
      if (params.unite_id) { conditions.push('r.unite_id = ?'); values.push(params.unite_id); }
      if (params.demandeur) { conditions.push('r.demandeur LIKE ?'); values.push(`%${params.demandeur}%`); }
      if (params.search) {
        conditions.push("(r.demandeur LIKE ? OR r.nature LIKE ? OR r.notes LIKE ?)");
        values.push(`%${params.search}%`, `%${params.search}%`, `%${params.search}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(params.limit);

      const rows = getDb().prepare(`
        SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
        FROM remboursements r
        LEFT JOIN unites u ON u.id = r.unite_id
        LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
        ${where}
        ORDER BY r.created_at DESC
        LIMIT ?
      `).all(...values) as Record<string, unknown>[];

      const result = rows.map(r => ({
        ...r,
        montant: formatAmount(r.amount_cents as number),
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'create_remboursement',
    'Crée une nouvelle demande de remboursement',
    {
      demandeur: z.string().describe('Nom de la personne qui demande le remboursement'),
      montant: z.string().describe('Montant (ex: "42,50")'),
      date_depense: z.string().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().describe('Nature de la dépense (transport, intendance, etc.)'),
      unite_id: z.string().optional().describe('Unité concernée (ex: u-lj)'),
      justificatif_status: z.enum(['oui', 'en_attente', 'non']).default('en_attente'),
      mode_paiement_id: z.string().optional().describe('Mode de paiement souhaité'),
      notes: z.string().optional(),
    },
    (params) => {
      const id = nextId('RBT');
      const cents = parseAmount(params.montant);
      const now = currentTimestamp();

      const { groupId } = getCurrentContext();
      getDb().prepare(`
        INSERT INTO remboursements (id, group_id, demandeur, amount_cents, date_depense, nature, unite_id, justificatif_status, mode_paiement_id, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, groupId, params.demandeur, cents, params.date_depense, params.nature, params.unite_id ?? null, params.justificatif_status, params.mode_paiement_id ?? null, params.notes ?? null, now, now);

      const row = getDb().prepare('SELECT * FROM remboursements WHERE id = ?').get(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ...row as object, montant: formatAmount(cents) }, null, 2) }] };
    }
  );

  server.tool(
    'update_remboursement',
    'Met à jour un remboursement (statut, date de paiement, justificatif, etc.)',
    {
      id: z.string().describe('ID du remboursement (ex: RBT-2026-001)'),
      status: z.enum(['demande', 'valide', 'paye', 'refuse']).optional(),
      date_paiement: z.string().optional().describe('Date du paiement effectif (YYYY-MM-DD)'),
      mode_paiement_id: z.string().optional(),
      justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
      comptaweb_synced: z.boolean().optional(),
      ecriture_id: z.string().optional().describe('ID de l\'écriture liée dans le journal'),
      notes: z.string().optional(),
    },
    (params) => {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (params.status !== undefined) { sets.push('status = ?'); values.push(params.status); }
      if (params.date_paiement !== undefined) { sets.push('date_paiement = ?'); values.push(params.date_paiement); }
      if (params.mode_paiement_id !== undefined) { sets.push('mode_paiement_id = ?'); values.push(params.mode_paiement_id); }
      if (params.justificatif_status !== undefined) { sets.push('justificatif_status = ?'); values.push(params.justificatif_status); }
      if (params.comptaweb_synced !== undefined) { sets.push('comptaweb_synced = ?'); values.push(params.comptaweb_synced ? 1 : 0); }
      if (params.ecriture_id !== undefined) { sets.push('ecriture_id = ?'); values.push(params.ecriture_id); }
      if (params.notes !== undefined) { sets.push('notes = ?'); values.push(params.notes); }

      if (sets.length === 0) {
        return { content: [{ type: 'text', text: 'Aucun champ à mettre à jour.' }] };
      }

      sets.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(params.id);

      const result = getDb().prepare(`UPDATE remboursements SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (result.changes === 0) {
        return { content: [{ type: 'text', text: `Remboursement ${params.id} non trouvé.` }] };
      }

      const row = getDb().prepare('SELECT * FROM remboursements WHERE id = ?').get(params.id);
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    }
  );
}
