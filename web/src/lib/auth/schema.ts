import { getDb } from '../db';

let ensured = false;

// Crée les tables nécessaires à Auth.js (chantier 4, ADR-016) si elles
// n'existent pas déjà. Idempotent. Appelé au lazy-init du module auth pour
// que `web/` puisse tourner sans dépendre du bootstrap.
//
// Depuis le chantier 6, le `web/scripts/bootstrap.ts` est aussi
// responsable de la création initiale du schéma métier. Ces tables auth
// y vivent en complément.
export async function ensureAuthSchema(): Promise<void> {
  if (ensured) return;
  const db = getDb();

  await db.exec(`
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
  const cols = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('email_verified')) {
    await db.exec('ALTER TABLE users ADD COLUMN email_verified TEXT');
  }
  // Chantier 5 : scope unitaire d'un chef d'unité ou d'un parent. NULL
  // pour tresorier/RG (vue globale). Le rôle vit dans la colonne `role`
  // (texte libre, valeurs documentées dans `UserRole` de `lib/context.ts`).
  if (!has('scope_unite_id')) {
    await db.exec('ALTER TABLE users ADD COLUMN scope_unite_id TEXT REFERENCES unites(id)');
  }

  // ADR-019 : migration des rôles applicatifs vers la hiérarchie V2.
  //
  // L'ancien schéma `users` (hérité de compta/src/schema.sql, supprimé au
  // chantier 6) impose une CHECK contraignant `role` à
  // `('tresorier', 'cotresorier', 'chef_unite', 'parent', 'membre_autre_groupe')`.
  // Cette enum SQL bloque les nouveaux rôles `RG`, `chef`, `equipier`.
  // SQLite ne supporte pas DROP CONSTRAINT — on recrée la table sans la
  // CHECK sur `role`. La validation des valeurs vit désormais côté code
  // (`UserRole` dans `lib/context.ts`). La CHECK sur `statut` reste.
  //
  // Idempotent : ne tourne que si la CHECK ancienne est encore présente.
  const usersDef = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get<{ sql: string }>();

  if (usersDef?.sql && /CHECK\s*\(\s*role\s+IN\s*\([^)]*'cotresorier'/i.test(usersDef.sql)) {
    // Désactivation des FK le temps de la migration : les tables qui
    // référencent users(id) (sessions, api_tokens) bloqueraient le DROP
    // sinon. Réactivé en finally même en cas d'erreur.
    await db.exec('PRAGMA foreign_keys = OFF');
    try {
      // Cleanup d'une éventuelle tentative précédente avortée.
      await db.exec('DROP TABLE IF EXISTS users_new');
      await db.exec(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES groupes(id),
          person_id TEXT REFERENCES personnes(id),
          email TEXT NOT NULL,
          nom_affichage TEXT,
          role TEXT NOT NULL,
          scope_unite_id TEXT REFERENCES unites(id),
          statut TEXT NOT NULL DEFAULT 'actif' CHECK(statut IN ('actif', 'suspendu', 'invite', 'ancien')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          email_verified TEXT,
          UNIQUE(group_id, email)
        );
        INSERT INTO users_new (id, group_id, person_id, email, nom_affichage, role, scope_unite_id, statut, created_at, updated_at, email_verified)
          SELECT id, group_id, person_id, email, nom_affichage, role, scope_unite_id, statut, created_at, updated_at, email_verified FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);
        CREATE INDEX IF NOT EXISTS idx_users_person ON users(person_id);
      `);
    } finally {
      await db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // Migration des valeurs de rôle. Idempotent. Doit tourner APRÈS la
  // suppression de la CHECK car les anciennes valeurs cibles (`chef`)
  // n'étaient pas autorisées par la CHECK.
  await db.exec("UPDATE users SET role = 'tresorier' WHERE role = 'cotresorier'");
  await db.exec("UPDATE users SET role = 'chef' WHERE role = 'chef_unite'");

  // Chantier 2 P2-workflows : lien remboursement ↔ user demandeur
  // (pour scoper "ses propres demandes" côté equipier/chef et envoyer
  // les notifs email).
  const remboursementCols = await db
    .prepare("PRAGMA table_info(remboursements)")
    .all<{ name: string }>();
  if (!remboursementCols.some((c) => c.name === 'submitted_by_user_id')) {
    await db.exec(
      'ALTER TABLE remboursements ADD COLUMN submitted_by_user_id TEXT REFERENCES users(id)',
    );
  }

  // Chantier 3 P2-workflows : idem côté abandons.
  const abandonCols = await db
    .prepare("PRAGMA table_info(abandons_frais)")
    .all<{ name: string }>();
  if (!abandonCols.some((c) => c.name === 'submitted_by_user_id')) {
    await db.exec(
      'ALTER TABLE abandons_frais ADD COLUMN submitted_by_user_id TEXT REFERENCES users(id)',
    );
  }

  // Chantier 4 P2-workflows : lier les mouvements de caisse à une
  // unité et / ou une activité (caisse de camp, de WE, etc.).
  const caisseCols = await db
    .prepare("PRAGMA table_info(mouvements_caisse)")
    .all<{ name: string }>();
  if (!caisseCols.some((c) => c.name === 'unite_id')) {
    await db.exec('ALTER TABLE mouvements_caisse ADD COLUMN unite_id TEXT REFERENCES unites(id)');
  }
  if (!caisseCols.some((c) => c.name === 'activite_id')) {
    await db.exec('ALTER TABLE mouvements_caisse ADD COLUMN activite_id TEXT REFERENCES activites(id)');
  }

  ensured = true;
}
