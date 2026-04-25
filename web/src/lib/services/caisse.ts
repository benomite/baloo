import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { MouvementCaisse } from '../types';

export interface CaisseContext {
  groupId: string;
}

export interface ListMouvementsCaisseOptions {
  limit?: number;
}

export function listMouvementsCaisse(
  { groupId }: CaisseContext,
  { limit = 50 }: ListMouvementsCaisseOptions = {},
): { mouvements: MouvementCaisse[]; solde: number } {
  const db = getDb();

  const mouvements = db
    .prepare(
      'SELECT * FROM mouvements_caisse WHERE group_id = ? ORDER BY date_mouvement DESC, created_at DESC LIMIT ?',
    )
    .all(groupId, limit) as MouvementCaisse[];

  const soldeRow = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get(groupId) as { total: number };

  return { mouvements, solde: soldeRow.total };
}

export interface CreateMouvementCaisseInput {
  date_mouvement: string;
  description: string;
  amount_cents: number;
  notes?: string | null;
}

export function createMouvementCaisse(
  { groupId }: CaisseContext,
  input: CreateMouvementCaisseInput,
): MouvementCaisse {
  const db = getDb();
  const id = nextId('CAI');
  const now = currentTimestamp();

  const soldeBefore = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get(groupId) as { total: number };
  const soldeAfter = soldeBefore.total + input.amount_cents;

  db.prepare(
    `INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, solde_apres_cents, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, input.date_mouvement, input.description, input.amount_cents, soldeAfter, input.notes ?? null, now);

  return db.prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get(id) as MouvementCaisse;
}
