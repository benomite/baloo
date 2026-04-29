import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';
import type { MouvementCaisse } from '../types';

export interface CaisseContext {
  groupId: string;
  // Si défini, restreint aux mouvements de cette unité (vue chef).
  scopeUniteId?: string | null;
}

export interface ListMouvementsCaisseOptions {
  limit?: number;
  unite_id?: string | null;
  activite_id?: string | null;
}

export async function listMouvementsCaisse(
  { groupId, scopeUniteId }: CaisseContext,
  options: ListMouvementsCaisseOptions = {},
): Promise<{ mouvements: MouvementCaisse[]; solde: number }> {
  const db = getDb();
  const { limit = 50 } = options;

  const conditions: string[] = ['m.group_id = ?'];
  const values: unknown[] = [groupId];
  if (scopeUniteId) {
    conditions.push('m.unite_id = ?');
    values.push(scopeUniteId);
  } else if (options.unite_id) {
    conditions.push('m.unite_id = ?');
    values.push(options.unite_id);
  }
  if (options.activite_id) {
    conditions.push('m.activite_id = ?');
    values.push(options.activite_id);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const mouvements = await db
    .prepare(
      `SELECT m.*, u.code AS unite_code, a.name AS activite_name
       FROM mouvements_caisse m
       LEFT JOIN unites u ON u.id = m.unite_id
       LEFT JOIN activites a ON a.id = m.activite_id
       ${where}
       ORDER BY m.date_mouvement DESC, m.created_at DESC LIMIT ?`,
    )
    .all<MouvementCaisse & { unite_code?: string | null; activite_name?: string | null }>(...values, limit);

  const soldeRow = await db
    .prepare(`SELECT COALESCE(SUM(m.amount_cents), 0) as total FROM mouvements_caisse m ${where}`)
    .get<{ total: number }>(...values);

  return { mouvements, solde: soldeRow?.total ?? 0 };
}

export interface CreateMouvementCaisseInput {
  date_mouvement: string;
  description: string;
  amount_cents: number;
  unite_id?: string | null;
  activite_id?: string | null;
  notes?: string | null;
}

export async function createMouvementCaisse(
  { groupId }: CaisseContext,
  input: CreateMouvementCaisseInput,
): Promise<MouvementCaisse> {
  const db = getDb();
  const id = await nextId('CAI');
  const now = currentTimestamp();

  // Solde "global" du groupe — `solde_apres_cents` reste un running
  // total non scoped même en présence d'unite_id, pour rester cohérent
  // avec l'historique existant.
  const soldeBefore = await db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get<{ total: number }>(groupId);
  const soldeAfter = (soldeBefore?.total ?? 0) + input.amount_cents;

  await db.prepare(
    `INSERT INTO mouvements_caisse (id, group_id, date_mouvement, description, amount_cents, unite_id, activite_id, solde_apres_cents, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.date_mouvement,
    input.description,
    input.amount_cents,
    nullIfEmpty(input.unite_id),
    nullIfEmpty(input.activite_id),
    soldeAfter,
    nullIfEmpty(input.notes),
    now,
  );

  return (await db.prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get<MouvementCaisse>(id))!;
}
