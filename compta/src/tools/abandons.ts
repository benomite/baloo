import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, formatAmount, parseAmount, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';

export function registerAbandonTools(server: McpServer) {
  server.tool(
    'list_abandons',
    'Liste les abandons de frais (dépenses non remboursées, don à l\'asso)',
    {
      annee_fiscale: z.string().optional().describe('Filtrer par année fiscale (ex: "2025")'),
      donateur: z.string().optional(),
      limit: z.number().default(50),
    },
    (params) => {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (params.annee_fiscale) { conditions.push('a.annee_fiscale = ?'); values.push(params.annee_fiscale); }
      if (params.donateur) { conditions.push('a.donateur LIKE ?'); values.push(`%${params.donateur}%`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(params.limit);

      const rows = getDb().prepare(`
        SELECT a.*, u.code as unite_code
        FROM abandons_frais a
        LEFT JOIN unites u ON u.id = a.unite_id
        ${where}
        ORDER BY a.created_at DESC LIMIT ?
      `).all(...values) as Record<string, unknown>[];

      return { content: [{ type: 'text', text: JSON.stringify(rows.map(r => ({ ...r, montant: formatAmount(r.amount_cents as number) })), null, 2) }] };
    }
  );

  server.tool(
    'create_abandon',
    'Enregistre un abandon de frais (don à l\'asso ouvrant droit à reçu fiscal)',
    {
      donateur: z.string().describe('Nom de la personne'),
      montant: z.string().describe('Montant abandonné (ex: "42,50")'),
      date_depense: z.string().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().describe('Nature de la dépense'),
      unite_id: z.string().optional(),
      annee_fiscale: z.string().describe('Année fiscale pour le CERFA (ex: "2025")'),
      notes: z.string().optional(),
    },
    (params) => {
      const id = nextId('ABF');
      const cents = parseAmount(params.montant);
      const now = currentTimestamp();

      const { groupId } = getCurrentContext();
      getDb().prepare(`
        INSERT INTO abandons_frais (id, group_id, donateur, amount_cents, date_depense, nature, unite_id, annee_fiscale, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, groupId, params.donateur, cents, params.date_depense, params.nature, params.unite_id ?? null, params.annee_fiscale, params.notes ?? null, now, now);

      const row = getDb().prepare('SELECT * FROM abandons_frais WHERE id = ?').get(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ...row as object, montant: formatAmount(cents) }, null, 2) }] };
    }
  );

  server.tool(
    'update_abandon',
    'Met à jour un abandon de frais (CERFA émis, notes, etc.)',
    {
      id: z.string().describe('ID de l\'abandon (ex: ABF-2026-001)'),
      cerfa_emis: z.boolean().optional().describe('Le CERFA fiscal a-t-il été émis ?'),
      notes: z.string().optional(),
    },
    (params) => {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (params.cerfa_emis !== undefined) { sets.push('cerfa_emis = ?'); values.push(params.cerfa_emis ? 1 : 0); }
      if (params.notes !== undefined) { sets.push('notes = ?'); values.push(params.notes); }

      if (sets.length === 0) return { content: [{ type: 'text', text: 'Aucun champ à mettre à jour.' }] };

      sets.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(params.id);

      getDb().prepare(`UPDATE abandons_frais SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      const row = getDb().prepare('SELECT * FROM abandons_frais WHERE id = ?').get(params.id);
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    }
  );
}
