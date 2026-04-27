import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { MouvementCaisse } from '../types';

export interface CaisseContext {
  groupId: string;
}

export interface ListMouvementsCaisseOptions {
  limit?: number;
}

export async function listMouvementsCaisse(
  { groupId }: CaisseContext,
  { limit = 50 }: ListMouvementsCaisseOptions = {},
): Promise<{ mouvements: MouvementCaisse[]; solde: number }> {
  const db = getDb();

  const mouvements = await db
    .prepare(
      'SELECT * FROM mouvements_caisse WHERE group_id = ? ORDER BY date_mouvement DESC, created_at DESC LIMIT ?',
    )
    .all<MouvementCaisse>(groupId, limit);

  const soldeRow = await db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get<{ total: number }>(groupId);

  return { mouvements, solde: soldeRow?.total ?? 0 };
}

export interface CreateMouvementCaisseInput {
  date_mouvement: string;
  description: string;
  amount_cents: number;
  notes?: string | null;
}

export async function createMouvementCaisse(
  { groupId }: CaisseContext,
  input: CreateMouvementCaisseInput,
): Promise<MouvementCaisse> {
  const db = getDb();
  const id = await nextId('CAI');
  const now = currentTimestamp();

  const soldeBefore = await db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get<{ total: number }>(groupId);
  const soldeAfter = (soldeBefore?.total ?? 0) + input.amount_cents;

  await db.prepare(
    `INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, solde_apres_cents, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, input.date_mouvement, input.description, input.amount_cents, soldeAfter, input.notes ?? null, now);

  return (await db.prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get<MouvementCaisse>(id))!;
}
