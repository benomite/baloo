import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface BudgetContext {
  groupId: string;
}

export type BudgetStatut = 'projet' | 'vote' | 'cloture';
export type BudgetLigneType = 'depense' | 'recette';

export interface Budget {
  id: string;
  group_id: string;
  saison: string;
  statut: BudgetStatut;
  vote_le: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetLigne {
  id: string;
  budget_id: string;
  unite_id: string | null;
  category_id: string | null;
  libelle: string;
  type: BudgetLigneType;
  amount_cents: number;
  notes: string | null;
}

export interface ListBudgetsOptions {
  saison?: string;
}

export async function listBudgets(
  { groupId }: BudgetContext,
  options: ListBudgetsOptions = {},
): Promise<Budget[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.saison) { conditions.push('saison = ?'); values.push(options.saison); }

  return await getDb().prepare(
    `SELECT * FROM budgets WHERE ${conditions.join(' AND ')} ORDER BY saison DESC`,
  ).all<Budget>(...values);
}

export interface CreateBudgetInput {
  saison: string;
  statut?: BudgetStatut;
  vote_le?: string | null;
  notes?: string | null;
}

export async function createBudget(
  { groupId }: BudgetContext,
  input: CreateBudgetInput,
): Promise<Budget> {
  const id = `bdg-${groupId}-${input.saison}`;
  const now = currentTimestamp();

  await getDb().prepare(
    `INSERT INTO budgets (id, group_id, saison, statut, vote_le, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.saison,
    input.statut ?? 'projet',
    input.vote_le ?? null,
    input.notes ?? null,
    now,
    now,
  );

  return (await getDb().prepare('SELECT * FROM budgets WHERE id = ?').get<Budget>(id))!;
}

export interface CreateBudgetLigneInput {
  budget_id: string;
  libelle: string;
  type: BudgetLigneType;
  amount_cents: number;
  unite_id?: string | null;
  category_id?: string | null;
  notes?: string | null;
}

export async function createBudgetLigne(input: CreateBudgetLigneInput): Promise<BudgetLigne> {
  const now = currentTimestamp();
  const id = `bdl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  await getDb().prepare(
    `INSERT INTO budget_lignes (id, budget_id, unite_id, category_id, libelle, type, amount_cents, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.budget_id,
    input.unite_id ?? null,
    input.category_id ?? null,
    input.libelle,
    input.type,
    input.amount_cents,
    input.notes ?? null,
    now,
    now,
  );

  return (await getDb().prepare('SELECT * FROM budget_lignes WHERE id = ?').get<BudgetLigne>(id))!;
}

export interface BudgetLignesSummary {
  lignes: BudgetLigne[];
  total_depenses_cents: number;
  total_recettes_cents: number;
  solde_cents: number;
}

export async function listBudgetLignes(budgetId: string): Promise<BudgetLignesSummary> {
  const lignes = await getDb().prepare(
    `SELECT id, unite_id, category_id, libelle, type, amount_cents, notes
     FROM budget_lignes WHERE budget_id = ? ORDER BY type, libelle`,
  ).all<BudgetLigne>(budgetId);

  const total_depenses_cents = lignes.filter((l) => l.type === 'depense').reduce((acc, l) => acc + l.amount_cents, 0);
  const total_recettes_cents = lignes.filter((l) => l.type === 'recette').reduce((acc, l) => acc + l.amount_cents, 0);

  return {
    lignes,
    total_depenses_cents,
    total_recettes_cents,
    solde_cents: total_recettes_cents - total_depenses_cents,
  };
}
