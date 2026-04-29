import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';

export interface AbandonContext {
  groupId: string;
  // Chantier 5 : si défini, restreint aux abandons rattachés à cette unité.
  scopeUniteId?: string | null;
  // Chantier 3 P2-workflows : si défini, restreint aux abandons soumis
  // par ce user (vue "mes dons" côté equipier).
  submittedByUserId?: string | null;
}

export interface Abandon {
  id: string;
  group_id: string;
  donateur: string;
  amount_cents: number;
  date_depense: string;
  nature: string;
  unite_id: string | null;
  annee_fiscale: string;
  cerfa_emis: number;
  notes: string | null;
  submitted_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  unite_code?: string | null;
}

export interface ListAbandonsOptions {
  annee_fiscale?: string;
  donateur?: string;
  limit?: number;
}

export async function listAbandons(
  { groupId, scopeUniteId, submittedByUserId }: AbandonContext,
  options: ListAbandonsOptions = {},
): Promise<Abandon[]> {
  const conditions: string[] = ['a.group_id = ?'];
  const values: unknown[] = [groupId];

  if (scopeUniteId) { conditions.push('a.unite_id = ?'); values.push(scopeUniteId); }
  if (submittedByUserId) { conditions.push('a.submitted_by_user_id = ?'); values.push(submittedByUserId); }
  if (options.annee_fiscale) { conditions.push('a.annee_fiscale = ?'); values.push(options.annee_fiscale); }
  if (options.donateur) { conditions.push('a.donateur LIKE ?'); values.push(`%${options.donateur}%`); }

  return await getDb().prepare(
    `SELECT a.*, u.code as unite_code
     FROM abandons_frais a
     LEFT JOIN unites u ON u.id = a.unite_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC LIMIT ?`,
  ).all<Abandon>(...values, options.limit ?? 50);
}

export interface CreateAbandonInput {
  donateur: string;
  amount_cents: number;
  date_depense: string;
  nature: string;
  unite_id?: string | null;
  annee_fiscale: string;
  notes?: string | null;
  submitted_by_user_id?: string | null;
}

export async function createAbandon(
  { groupId }: AbandonContext,
  input: CreateAbandonInput,
): Promise<Abandon> {
  const db = getDb();
  const id = await nextId('ABF');
  const now = currentTimestamp();

  await db.prepare(
    `INSERT INTO abandons_frais (id, group_id, donateur, amount_cents, date_depense, nature, unite_id, annee_fiscale, notes, submitted_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.donateur,
    input.amount_cents,
    input.date_depense,
    input.nature,
    input.unite_id ?? null,
    input.annee_fiscale,
    input.notes ?? null,
    input.submitted_by_user_id ?? null,
    now,
    now,
  );

  return (await db.prepare('SELECT * FROM abandons_frais WHERE id = ?').get<Abandon>(id))!;
}

export interface UpdateAbandonInput {
  cerfa_emis?: boolean;
  notes?: string | null;
}

export async function updateAbandon(
  { groupId }: AbandonContext,
  id: string,
  patch: UpdateAbandonInput,
): Promise<Abandon | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.cerfa_emis !== undefined) { sets.push('cerfa_emis = ?'); values.push(patch.cerfa_emis ? 1 : 0); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }

  if (sets.length === 0) {
    return (await getDb()
      .prepare('SELECT * FROM abandons_frais WHERE id = ? AND group_id = ?')
      .get<Abandon>(id, groupId)) ?? null;
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = await getDb()
    .prepare(`UPDATE abandons_frais SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return (await getDb()
    .prepare('SELECT * FROM abandons_frais WHERE id = ?')
    .get<Abandon>(id))!;
}
