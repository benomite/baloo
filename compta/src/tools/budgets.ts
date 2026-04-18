import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb, formatAmount, parseAmount } from '../db.js';
import { getCurrentContext } from '../context.js';

const STATUTS = ['projet', 'vote', 'cloture'] as const;

export function registerBudgetTools(server: McpServer) {
  server.tool(
    'list_budgets',
    "Liste les budgets annuels du groupe.",
    { saison: z.string().optional() },
    ({ saison }) => {
      const { groupId } = getCurrentContext();
      let sql = 'SELECT * FROM budgets WHERE group_id = ?';
      const params: (string | number)[] = [groupId];
      if (saison) { sql += ' AND saison = ?'; params.push(saison); }
      sql += ' ORDER BY saison DESC';
      const rows = getDb().prepare(sql).all(...params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    'create_budget',
    "Crée un budget annuel (saison ex: '2025-2026').",
    {
      saison: z.string().min(4).describe("Format '2025-2026'"),
      statut: z.enum(STATUTS).optional(),
      vote_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    ({ saison, statut, vote_le, notes }) => {
      const ctx = getCurrentContext();
      const id = `bdg-${ctx.groupId}-${saison}`;
      const now = currentTimestamp();
      getDb().prepare(
        `INSERT INTO budgets (id, group_id, saison, statut, vote_le, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, ctx.groupId, saison, statut ?? 'projet', vote_le ?? null, notes ?? null, now, now);
      return { content: [{ type: 'text', text: `Budget ${id} créé (saison ${saison}).` }] };
    }
  );

  server.tool(
    'create_budget_ligne',
    "Ajoute une ligne à un budget (poste budgétaire).",
    {
      budget_id: z.string(),
      libelle: z.string().min(1),
      type: z.enum(['depense', 'recette']),
      amount: z.string().describe("Montant en format français, ex: '19 000' ou '1 234,56'"),
      unite_id: z.string().optional(),
      category_id: z.string().optional(),
      notes: z.string().optional(),
    },
    ({ budget_id, libelle, type, amount, unite_id, category_id, notes }) => {
      const now = currentTimestamp();
      const cents = parseAmount(amount);
      const id = `bdl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      getDb().prepare(
        `INSERT INTO budget_lignes (id, budget_id, unite_id, category_id, libelle, type, amount_cents, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, budget_id, unite_id ?? null, category_id ?? null, libelle, type, cents, notes ?? null, now, now);
      return { content: [{ type: 'text', text: `Ligne ${id} ajoutée : ${libelle} (${formatAmount(cents)}).` }] };
    }
  );

  server.tool(
    'list_budget_lignes',
    "Liste les lignes d'un budget, avec totaux par type.",
    { budget_id: z.string() },
    ({ budget_id }) => {
      const rows = getDb().prepare(
        'SELECT id, unite_id, category_id, libelle, type, amount_cents, notes FROM budget_lignes WHERE budget_id = ? ORDER BY type, libelle'
      ).all(budget_id) as { id: string; unite_id: string | null; category_id: string | null; libelle: string; type: string; amount_cents: number; notes: string | null }[];
      const totalDepenses = rows.filter(r => r.type === 'depense').reduce((acc, r) => acc + r.amount_cents, 0);
      const totalRecettes = rows.filter(r => r.type === 'recette').reduce((acc, r) => acc + r.amount_cents, 0);
      const result = {
        lignes: rows.map(r => ({ ...r, montant: formatAmount(r.amount_cents) })),
        total_depenses: formatAmount(totalDepenses),
        total_recettes: formatAmount(totalRecettes),
        solde: formatAmount(totalRecettes - totalDepenses),
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
