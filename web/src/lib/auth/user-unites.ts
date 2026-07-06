import type { getDb } from '../db';

// Périmètre unité d'un user (chef multi-unités) : liste des `unite_id` de la
// table de jointure `user_unites`. VIDE = aucune restriction (tresorier/RG,
// vue globale). Source de vérité du scope (remplace users.scope_unite_id).
export async function loadUserUniteIds(
  db: Pick<ReturnType<typeof getDb>, 'prepare'>,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .prepare('SELECT unite_id FROM user_unites WHERE user_id = ? ORDER BY unite_id')
    .all<{ unite_id: string }>(userId);
  return rows.map((r) => r.unite_id);
}

// Remplace le périmètre d'un user par la liste fournie (dédupliquée). Pas de
// DELETE de données métier ici — `user_unites` est une pure table d'accès.
export async function setUserUnites(
  db: Pick<ReturnType<typeof getDb>, 'prepare'>,
  userId: string,
  uniteIds: string[],
): Promise<void> {
  await db.prepare('DELETE FROM user_unites WHERE user_id = ?').run(userId);
  const unique = [...new Set(uniteIds.filter(Boolean))];
  for (const uniteId of unique) {
    await db
      .prepare('INSERT OR IGNORE INTO user_unites (user_id, unite_id) VALUES (?, ?)')
      .run(userId, uniteId);
  }
}
