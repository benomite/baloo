import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, formatAmount, parseAmount, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';

export function registerCaisseTools(server: McpServer) {
  server.tool(
    'list_mouvements_caisse',
    'Liste les mouvements de caisse (espèces) avec solde courant',
    { limit: z.number().default(50) },
    (params) => {
      const rows = getDb().prepare(`
        SELECT * FROM mouvements_caisse ORDER BY date_mouvement DESC, created_at DESC LIMIT ?
      `).all(params.limit) as Record<string, unknown>[];

      const solde = getDb().prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse'
      ).get() as { total: number };

      const result = rows.map(r => ({
        ...r,
        montant: formatAmount(r.amount_cents as number),
        solde_apres: r.solde_apres_cents != null ? formatAmount(r.solde_apres_cents as number) : null,
      }));

      return { content: [{ type: 'text', text: JSON.stringify({ solde_caisse: formatAmount(solde.total), mouvements: result }, null, 2) }] };
    }
  );

  server.tool(
    'create_mouvement_caisse',
    'Enregistre un mouvement de caisse (entrée ou sortie d\'espèces)',
    {
      date_mouvement: z.string().describe('Date du mouvement (YYYY-MM-DD)'),
      description: z.string().describe('Description'),
      montant: z.string().describe('Montant signé : "+15,00" pour entrée, "-8,50" pour sortie'),
      notes: z.string().optional(),
    },
    (params) => {
      const id = nextId('CAI');
      const cents = parseAmount(params.montant);
      const now = currentTimestamp();

      const soldeBefore = getDb().prepare(
        'SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse'
      ).get() as { total: number };
      const soldeAfter = soldeBefore.total + cents;

      getDb().prepare(`
        INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, solde_apres_cents, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, getCurrentContext().groupId, params.date_mouvement, params.description, cents, soldeAfter, params.notes ?? null, now);

      const row = getDb().prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ...row as object, montant: formatAmount(cents), solde_apres: formatAmount(soldeAfter) }, null, 2) }] };
    }
  );
}
