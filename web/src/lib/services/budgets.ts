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
  activite_id: string | null;
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
  activite_id?: string | null;
  notes?: string | null;
}

// Renvoie null si le budget cible n'existe pas dans ce groupe — la
// route handler répond alors 404 sans révéler "n'existe pas" vs
// "n'est pas le tien" (anti-énumération inter-groupes).
export async function createBudgetLigne(
  { groupId }: BudgetContext,
  input: CreateBudgetLigneInput,
): Promise<BudgetLigne | null> {
  const owns = await getDb()
    .prepare('SELECT id FROM budgets WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(input.budget_id, groupId);
  if (!owns) return null;

  const now = currentTimestamp();
  const id = `bdl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  await getDb().prepare(
    `INSERT INTO budget_lignes (id, budget_id, unite_id, category_id, activite_id, libelle, type, amount_cents, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.budget_id,
    input.unite_id ?? null,
    input.category_id ?? null,
    input.activite_id ?? null,
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

// JOIN sur `budgets.group_id` : un budget d'un autre groupe renvoie
// un tableau vide, indistinguable d'un budget vide.
export async function listBudgetLignes(
  { groupId }: BudgetContext,
  budgetId: string,
): Promise<BudgetLignesSummary> {
  const lignes = await getDb().prepare(
    `SELECT bl.id, bl.budget_id, bl.unite_id, bl.category_id, bl.activite_id, bl.libelle, bl.type, bl.amount_cents, bl.notes
     FROM budget_lignes bl
     JOIN budgets b ON b.id = bl.budget_id
     WHERE bl.budget_id = ? AND b.group_id = ?
     ORDER BY bl.type, bl.libelle`,
  ).all<BudgetLigne>(budgetId, groupId);

  const total_depenses_cents = lignes.filter((l) => l.type === 'depense').reduce((acc, l) => acc + l.amount_cents, 0);
  const total_recettes_cents = lignes.filter((l) => l.type === 'recette').reduce((acc, l) => acc + l.amount_cents, 0);

  return {
    lignes,
    total_depenses_cents,
    total_recettes_cents,
    solde_cents: total_recettes_cents - total_depenses_cents,
  };
}

export type UpdateBudgetLigneInput = Partial<{
  libelle: string;
  type: BudgetLigneType;
  amount_cents: number;
  unite_id: string | null;
  category_id: string | null;
  activite_id: string | null;
  notes: string | null;
}>;

// Patch partiel d'une ligne budget. Anti-énumération via JOIN sur
// budgets : si la ligne n'appartient pas à un budget du groupe courant,
// retourne null (la route handler répond 404).
export async function updateBudgetLigne(
  { groupId }: BudgetContext,
  ligneId: string,
  patch: UpdateBudgetLigneInput,
): Promise<BudgetLigne | null> {
  const db = getDb();
  const owned = await db
    .prepare(
      `SELECT bl.id FROM budget_lignes bl
       JOIN budgets b ON b.id = bl.budget_id
       WHERE bl.id = ? AND b.group_id = ?`,
    )
    .get<{ id: string }>(ligneId, groupId);
  if (!owned) return null;

  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.libelle !== undefined) { sets.push('libelle = ?'); values.push(patch.libelle); }
  if (patch.type !== undefined) { sets.push('type = ?'); values.push(patch.type); }
  if (patch.amount_cents !== undefined) { sets.push('amount_cents = ?'); values.push(patch.amount_cents); }
  if (patch.unite_id !== undefined) { sets.push('unite_id = ?'); values.push(patch.unite_id); }
  if (patch.category_id !== undefined) { sets.push('category_id = ?'); values.push(patch.category_id); }
  if (patch.activite_id !== undefined) { sets.push('activite_id = ?'); values.push(patch.activite_id); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }
  if (sets.length === 0) {
    return (await db.prepare('SELECT * FROM budget_lignes WHERE id = ?').get<BudgetLigne>(ligneId))!;
  }
  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(ligneId);
  await db.prepare(`UPDATE budget_lignes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return (await db.prepare('SELECT * FROM budget_lignes WHERE id = ?').get<BudgetLigne>(ligneId))!;
}

// DELETE simple. Le prévisionnel n'est pas concerné par la doctrine
// "jamais de DELETE" (qui vise écritures, justifs, rembs, etc.). Anti-
// énumération : retourne false si la ligne n'appartient pas au groupe.
export async function deleteBudgetLigne(
  { groupId }: BudgetContext,
  ligneId: string,
): Promise<boolean> {
  const db = getDb();
  const owned = await db
    .prepare(
      `SELECT bl.id FROM budget_lignes bl
       JOIN budgets b ON b.id = bl.budget_id
       WHERE bl.id = ? AND b.group_id = ?`,
    )
    .get<{ id: string }>(ligneId, groupId);
  if (!owned) return false;
  await db.prepare('DELETE FROM budget_lignes WHERE id = ?').run(ligneId);
  return true;
}

// Change le statut d'un budget (projet → vote → cloture). Anti-
// énumération via group_id. vote_le posé à la date du jour quand statut
// devient 'vote' ; conservé sinon (COALESCE) au cas où on rebascule.
export async function updateBudgetStatut(
  { groupId }: BudgetContext,
  budgetId: string,
  statut: BudgetStatut,
): Promise<Budget | null> {
  const db = getDb();
  const owned = await db
    .prepare('SELECT id FROM budgets WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(budgetId, groupId);
  if (!owned) return null;
  const now = currentTimestamp();
  const voteLe = statut === 'vote' ? now.slice(0, 10) : null;
  await db
    .prepare('UPDATE budgets SET statut = ?, vote_le = COALESCE(?, vote_le), updated_at = ? WHERE id = ?')
    .run(statut, voteLe, now, budgetId);
  return (await db.prepare('SELECT * FROM budgets WHERE id = ?').get<Budget>(budgetId))!;
}
