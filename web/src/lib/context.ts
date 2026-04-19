import { getDb } from './db';
import { ensureComptawebEnv } from './comptaweb/env-loader';

let cached: { userId: string; groupId: string } | null = null;

export function getCurrentContext(): { userId: string; groupId: string } {
  if (cached) return cached;
  ensureComptawebEnv();
  const email = process.env.BALOO_USER_EMAIL;
  if (!email) {
    throw new Error("BALOO_USER_EMAIL manquant dans l'environnement Next (web/.env.local).");
  }
  const row = getDb()
    .prepare("SELECT id as user_id, group_id FROM users WHERE email = ? AND statut = 'actif' LIMIT 1")
    .get(email) as { user_id: string; group_id: string } | undefined;
  if (!row) {
    throw new Error(`Aucun user actif trouvé pour ${email}. Lance \`cd compta && npm run bootstrap\`.`);
  }
  cached = { userId: row.user_id, groupId: row.group_id };
  return cached;
}
