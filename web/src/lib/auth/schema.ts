import { getDb } from '../db';

let ensured = false;

// Crée les tables nécessaires à Auth.js (chantier 4, ADR-016) si elles
// n'existent pas déjà. Idempotent. Appelé au lazy-init du module auth pour
// que `web/` puisse tourner sans dépendre du bootstrap.
//
// Depuis le chantier 6, le `web/scripts/bootstrap.ts` est aussi
// responsable de la création initiale du schéma métier. Ces tables auth
// y vivent en complément.
export function ensureAuthSchema(): void {
  if (ensured) return;
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires TEXT NOT NULL,
      PRIMARY KEY (identifier, token)
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
  `);

  // Migrations idempotentes sur la table `users`.
  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('email_verified')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified TEXT');
  }
  // Chantier 5 : scope unitaire d'un chef d'unité ou d'un parent. NULL
  // pour tresorier (vue globale). Le rôle vit déjà dans la colonne `role`
  // (texte libre, valeurs documentées dans `web/src/lib/services/personnes.ts`).
  if (!has('scope_unite_id')) {
    db.exec('ALTER TABLE users ADD COLUMN scope_unite_id TEXT REFERENCES unites(id)');
  }

  ensured = true;
}
