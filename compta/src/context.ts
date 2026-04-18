import { getDb } from './db.js';
import { requireEnv } from './config.js';

export interface BalooContext {
  userId: string;
  groupId: string;
  userEmail: string;
  userName: string;
  groupName: string;
}

let cached: BalooContext | null = null;

export function getCurrentContext(): BalooContext {
  if (cached) return cached;

  const email = requireEnv('BALOO_USER_EMAIL');
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id AS user_id, u.nom_affichage AS user_name, u.email AS user_email,
              u.group_id AS group_id, g.nom AS group_name
       FROM users u
       JOIN groupes g ON g.id = u.group_id
       WHERE u.email = ? AND u.statut = 'actif'
       LIMIT 1`
    )
    .get(email) as
    | { user_id: string; user_name: string; user_email: string; group_id: string; group_name: string }
    | undefined;

  if (!row) {
    throw new Error(
      `Aucun user actif trouvé pour ${email}. Lance \`npm run bootstrap\` pour initialiser le groupe et l'utilisateur courants (cf. compta/.env.example).`
    );
  }

  cached = {
    userId: row.user_id,
    groupId: row.group_id,
    userEmail: row.user_email,
    userName: row.user_name,
    groupName: row.group_name,
  };
  return cached;
}

export function resetCachedContext(): void {
  cached = null;
}
