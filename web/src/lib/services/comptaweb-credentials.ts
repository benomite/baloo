// Credentials Comptaweb par groupe, stockés en BDD. Le mot de passe est
// chiffré (AES-256-GCM, cf. secret-box). Source de vérité de loadConfig, avec
// repli sur les variables d'env (transition). Pas de threading groupId en V1
// (mono-groupe) — garde-fou si > 1 ligne.
import { getDb } from '../db';
import { encryptSecret, decryptSecret } from '../crypto/secret-box';

export async function ensureComptawebCredentialsSchema(): Promise<void> {
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS comptaweb_credentials (
      group_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      base_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_by_user_id TEXT
    );
  `);
}

interface CredRow {
  group_id: string;
  username: string;
  password_encrypted: string;
  base_url: string | null;
  updated_at: string;
}

export async function getComptawebCredentials(): Promise<{ username: string; password: string; base_url: string | null } | null> {
  await ensureComptawebCredentialsSchema();
  const rows = await getDb().prepare('SELECT * FROM comptaweb_credentials').all<CredRow>();
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error('Plusieurs groupes ont des credentials Comptaweb : threading groupId requis (multi-groupe non supporté en V1).');
  }
  const row = rows[0];
  return { username: row.username, password: decryptSecret(row.password_encrypted), base_url: row.base_url };
}

export async function saveComptawebCredentials(
  groupId: string,
  userId: string,
  input: { username: string; password?: string },
): Promise<void> {
  await ensureComptawebCredentialsSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT password_encrypted FROM comptaweb_credentials WHERE group_id = ?').get<{ password_encrypted: string }>(groupId);

  // password fourni → on (re)chiffre ; sinon on garde l'existant (write-only).
  const passwordEncrypted = input.password
    ? encryptSecret(input.password)
    : existing?.password_encrypted;
  if (!passwordEncrypted) {
    throw new Error('Aucun mot de passe fourni et aucun existant à conserver.');
  }

  await db.prepare(
    `INSERT INTO comptaweb_credentials (group_id, username, password_encrypted, updated_at, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       username = excluded.username,
       password_encrypted = excluded.password_encrypted,
       updated_at = excluded.updated_at,
       updated_by_user_id = excluded.updated_by_user_id`,
  ).run(groupId, input.username, passwordEncrypted, now, userId);
}

export async function getComptawebCredentialsStatus(): Promise<{ configured: boolean; username: string | null; updated_at: string | null }> {
  await ensureComptawebCredentialsSchema();
  const rows = await getDb().prepare('SELECT username, updated_at FROM comptaweb_credentials').all<{ username: string; updated_at: string }>();
  if (rows.length === 0) return { configured: false, username: null, updated_at: null };
  return { configured: true, username: rows[0].username, updated_at: rows[0].updated_at };
}

export async function resolveComptawebCredentials(): Promise<{ username: string; password: string; baseUrl: string | null } | null> {
  const fromDb = await getComptawebCredentials();
  if (fromDb) return { username: fromDb.username, password: fromDb.password, baseUrl: fromDb.base_url };
  const username = process.env.COMPTAWEB_USERNAME;
  const password = process.env.COMPTAWEB_PASSWORD;
  if (username && password) return { username, password, baseUrl: process.env.COMPTAWEB_BASE_URL ?? null };
  return null;
}
