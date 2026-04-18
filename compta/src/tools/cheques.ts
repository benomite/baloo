import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, formatAmount, parseAmount, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';

export function registerChequesTools(server: McpServer) {
  server.tool(
    'list_depots_cheques',
    'Liste les dépôts de chèques (banque et ANCV)',
    {
      type_depot: z.enum(['banque', 'ancv']).optional(),
      confirmation_status: z.enum(['en_attente', 'confirme']).optional(),
      limit: z.number().default(50),
    },
    (params) => {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (params.type_depot) { conditions.push('type_depot = ?'); values.push(params.type_depot); }
      if (params.confirmation_status) { conditions.push('confirmation_status = ?'); values.push(params.confirmation_status); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(params.limit);

      const rows = getDb().prepare(
        `SELECT * FROM depots_cheques ${where} ORDER BY date_depot DESC LIMIT ?`
      ).all(...values) as Record<string, unknown>[];

      return { content: [{ type: 'text', text: JSON.stringify(rows.map(r => ({
        ...r,
        total: formatAmount(r.total_amount_cents as number),
        detail_cheques: r.detail_cheques ? JSON.parse(r.detail_cheques as string) : null,
      })), null, 2) }] };
    }
  );

  server.tool(
    'create_depot_cheques',
    'Enregistre un dépôt de chèques (banque ou ANCV)',
    {
      date_depot: z.string().describe('Date du dépôt (YYYY-MM-DD)'),
      type_depot: z.enum(['banque', 'ancv']).describe('Type : banque ou ANCV'),
      cheques: z.array(z.object({
        emetteur: z.string().describe('Nom de l\'émetteur'),
        montant: z.string().describe('Montant du chèque (ex: "50,00")'),
        numero: z.string().optional().describe('Numéro du chèque'),
      })).describe('Liste des chèques déposés'),
      notes: z.string().optional(),
    },
    (params) => {
      const id = nextId('DCH');
      const now = currentTimestamp();

      const chequesParsed = params.cheques.map(c => ({
        emetteur: c.emetteur,
        montant_cents: parseAmount(c.montant),
        numero: c.numero ?? null,
      }));
      const totalCents = chequesParsed.reduce((sum, c) => sum + c.montant_cents, 0);

      getDb().prepare(`
        INSERT INTO depots_cheques (id, group_id, date_depot, type_depot, total_amount_cents, nombre_cheques, detail_cheques, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, getCurrentContext().groupId, params.date_depot, params.type_depot, totalCents, chequesParsed.length, JSON.stringify(chequesParsed), params.notes ?? null, now);

      const row = getDb().prepare('SELECT * FROM depots_cheques WHERE id = ?').get(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ...row as object, total: formatAmount(totalCents) }, null, 2) }] };
    }
  );
}
