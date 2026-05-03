import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface ErrorLogRow {
  id: string;
  mod: string;
  message: string;
  error_name: string | null;
  stack: string | null;
  data_json: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_email?: string | null;
}

export interface ListErrorsOptions {
  unresolvedOnly?: boolean;
  mod?: string;
  limit?: number;
}

export async function listErrors(
  options: ListErrorsOptions = {},
): Promise<ErrorLogRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.unresolvedOnly) conditions.push('e.resolved_at IS NULL');
  if (options.mod) {
    conditions.push('e.mod = ?');
    values.push(options.mod);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return await getDb()
    .prepare(
      `SELECT e.*, u.email AS resolved_by_email
       FROM error_log e
       LEFT JOIN users u ON u.id = e.resolved_by
       ${where}
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
    .all<ErrorLogRow>(...values, options.limit ?? 100);
}

export async function countUnresolvedErrors(): Promise<number> {
  const row = await getDb()
    .prepare('SELECT COUNT(*) AS n FROM error_log WHERE resolved_at IS NULL')
    .get<{ n: number }>();
  return row?.n ?? 0;
}

export async function listDistinctMods(): Promise<string[]> {
  const rows = await getDb()
    .prepare('SELECT DISTINCT mod FROM error_log ORDER BY mod')
    .all<{ mod: string }>();
  return rows.map((r) => r.mod);
}

export async function markErrorResolved(
  id: string,
  resolvedByUserId: string,
): Promise<void> {
  await getDb()
    .prepare('UPDATE error_log SET resolved_at = ?, resolved_by = ? WHERE id = ?')
    .run(currentTimestamp(), resolvedByUserId, id);
}

export async function markErrorUnresolved(id: string): Promise<void> {
  await getDb()
    .prepare('UPDATE error_log SET resolved_at = NULL, resolved_by = NULL WHERE id = ?')
    .run(id);
}

// Résoudre toutes les erreurs avec le même mod + message (utile quand
// une même erreur a été journalisée 50 fois et qu'on veut tout
// "ranger" d'un coup après avoir fixé la cause).
export async function markErrorGroupResolved(
  mod: string,
  message: string,
  resolvedByUserId: string,
): Promise<number> {
  const result = await getDb()
    .prepare(
      'UPDATE error_log SET resolved_at = ?, resolved_by = ? WHERE mod = ? AND message = ? AND resolved_at IS NULL',
    )
    .run(currentTimestamp(), resolvedByUserId, mod, message);
  return result.changes;
}
