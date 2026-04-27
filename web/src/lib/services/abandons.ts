import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';

export interface AbandonContext {
  groupId: string;
  // Chantier 5 : si défini, restreint aux abandons rattachés à cette unité.
  scopeUniteId?: string | null;
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
  created_at: string;
  updated_at: string;
  unite_code?: string | null;
}

export interface ListAbandonsOptions {
  annee_fiscale?: string;
  donateur?: string;
  limit?: number;
}

export function listAbandons(
  { groupId, scopeUniteId }: AbandonContext,
  options: ListAbandonsOptions = {},
): Abandon[] {
  const conditions: string[] = ['a.group_id = ?'];
  const values: unknown[] = [groupId];

  if (scopeUniteId) { conditions.push('a.unite_id = ?'); values.push(scopeUniteId); }
  if (options.annee_fiscale) { conditions.push('a.annee_fiscale = ?'); values.push(options.annee_fiscale); }
  if (options.donateur) { conditions.push('a.donateur LIKE ?'); values.push(`%${options.donateur}%`); }

  return getDb().prepare(
    `SELECT a.*, u.code as unite_code
     FROM abandons_frais a
     LEFT JOIN unites u ON u.id = a.unite_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC LIMIT ?`,
  ).all(...values, options.limit ?? 50) as Abandon[];
}

export interface CreateAbandonInput {
  donateur: string;
  amount_cents: number;
  date_depense: string;
  nature: string;
  unite_id?: string | null;
  annee_fiscale: string;
  notes?: string | null;
}

export function createAbandon(
  { groupId }: AbandonContext,
  input: CreateAbandonInput,
): Abandon {
  const db = getDb();
  const id = nextId('ABF');
  const now = currentTimestamp();

  db.prepare(
    `INSERT INTO abandons_frais (id, group_id, donateur, amount_cents, date_depense, nature, unite_id, annee_fiscale, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    now,
    now,
  );

  return db.prepare('SELECT * FROM abandons_frais WHERE id = ?').get(id) as Abandon;
}

export interface UpdateAbandonInput {
  cerfa_emis?: boolean;
  notes?: string | null;
}

export function updateAbandon(
  { groupId }: AbandonContext,
  id: string,
  patch: UpdateAbandonInput,
): Abandon | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.cerfa_emis !== undefined) { sets.push('cerfa_emis = ?'); values.push(patch.cerfa_emis ? 1 : 0); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }

  if (sets.length === 0) {
    return getDb()
      .prepare('SELECT * FROM abandons_frais WHERE id = ? AND group_id = ?')
      .get(id, groupId) as Abandon | null;
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE abandons_frais SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getDb()
    .prepare('SELECT * FROM abandons_frais WHERE id = ?')
    .get(id) as Abandon;
}
