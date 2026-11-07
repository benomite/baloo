import type { DbWrapper } from '../db';

// Total (somme des amount_cents) d'un groupe de ventilation d'écritures.
export async function getVentilationGroupTotal(
  db: DbWrapper,
  groupId: string,
  ventilationGroupId: string,
): Promise<number> {
  const g = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS t
       FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
    )
    .get<{ t: number }>(groupId, ventilationGroupId);
  return g?.t ?? 0;
}
