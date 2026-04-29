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

    CREATE TABLE IF NOT EXISTS signin_attempts (
      identifier TEXT NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signin_attempts_id ON signin_attempts(identifier, attempted_at);

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

  // Chantier 2-bis P2-workflows : refonte du modèle remboursement vers
  // un modèle "1 demande = N lignes de dépense" (cf. workflow valdesous,
  // doc à venir). Recréation de la table pour :
  //  - retirer la CHECK SQL sur `status` (qui bloque les nouveaux statuts
  //    `valide_tresorier`, `valide_rg`, `virement_effectue`, `termine`)
  //  - ajouter les champs valdesous (prenom, nom, email, rib, tokens...)
  //  - ajouter total_cents (recalculé depuis les lignes)
  //  - ajouter motif_refus (auparavant fourré dans notes)
  //
  // SQLite ne supporte pas DROP CONSTRAINT → recréation. Idempotent :
  // détecté via la présence de l'ancienne CHECK 'demande' dans
  // sqlite_master.
  const remboursementsDef = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='remboursements'")
    .get<{ sql: string }>();

  if (remboursementsDef?.sql && /CHECK\s*\(\s*status\s+IN\s*\([^)]*'demande'/i.test(remboursementsDef.sql)) {
    await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.exec('DROP TABLE IF EXISTS remboursements_new');
      await db.exec(`
        CREATE TABLE remboursements_new (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          demandeur TEXT NOT NULL,
          prenom TEXT,
          nom TEXT,
          email TEXT,
          rib_texte TEXT,
          rib_file_path TEXT,
          amount_cents INTEGER NOT NULL DEFAULT 0,
          total_cents INTEGER NOT NULL DEFAULT 0,
          date_depense TEXT,
          nature TEXT,
          unite_id TEXT REFERENCES unites(id),
          justificatif_status TEXT NOT NULL DEFAULT 'en_attente',
          status TEXT NOT NULL DEFAULT 'a_traiter',
          motif_refus TEXT,
          date_paiement TEXT,
          mode_paiement_id TEXT REFERENCES modes_paiement(id),
          comptaweb_synced INTEGER NOT NULL DEFAULT 0,
          ecriture_id TEXT REFERENCES ecritures(id),
          notes TEXT,
          submitted_by_user_id TEXT REFERENCES users(id),
          edit_token TEXT,
          validate_token TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        INSERT INTO remboursements_new (
          id, group_id, demandeur, amount_cents, total_cents, date_depense, nature,
          unite_id, justificatif_status, status, date_paiement, mode_paiement_id,
          comptaweb_synced, ecriture_id, notes, submitted_by_user_id, created_at, updated_at
        )
        SELECT
          id, group_id, demandeur, amount_cents, amount_cents AS total_cents,
          date_depense, nature, unite_id, justificatif_status,
          CASE status
            WHEN 'demande' THEN 'a_traiter'
            WHEN 'valide' THEN 'valide_tresorier'
            WHEN 'paye' THEN 'virement_effectue'
            WHEN 'refuse' THEN 'refuse'
            ELSE status
          END AS status,
          date_paiement, mode_paiement_id, comptaweb_synced, ecriture_id, notes,
          submitted_by_user_id, created_at, updated_at
        FROM remboursements;
        DROP TABLE remboursements;
        ALTER TABLE remboursements_new RENAME TO remboursements;
        CREATE INDEX IF NOT EXISTS idx_rbt_group ON remboursements(group_id);
        CREATE INDEX IF NOT EXISTS idx_rbt_status ON remboursements(status);
        CREATE INDEX IF NOT EXISTS idx_rbt_demandeur ON remboursements(demandeur);
        CREATE INDEX IF NOT EXISTS idx_rbt_edit_token ON remboursements(edit_token);
        CREATE INDEX IF NOT EXISTS idx_rbt_validate_token ON remboursements(validate_token);
      `);
    } finally {
      await db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // Table des lignes de dépense (chantier 2-bis). Une demande de
  // remboursement contient N lignes (1 ligne = 1 ticket / facture).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS remboursement_lignes (
      id TEXT PRIMARY KEY,
      remboursement_id TEXT NOT NULL REFERENCES remboursements(id),
      date_depense TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      nature TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rbt_ligne_rbt ON remboursement_lignes(remboursement_id);
  `);

  // Migration des anciennes demandes mono-ligne vers le modèle
  // multi-lignes : pour chaque rbt qui n'a aucune ligne, on crée une
  // ligne reprenant les anciens champs. Idempotent.
  await db.exec(`
    INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, created_at)
    SELECT
      'rbtl-' || r.id AS id,
      r.id,
      COALESCE(r.date_depense, DATE('now')),
      COALESCE(r.amount_cents, 0),
      COALESCE(r.nature, '(migré sans détail)'),
      r.created_at
    FROM remboursements r
    WHERE NOT EXISTS (
      SELECT 1 FROM remboursement_lignes l WHERE l.remboursement_id = r.id
    )
  `);

  // Chantier 2-ter (ADR-023) : signatures électroniques simples avec
  // chaînage interne (mini-audit-trail immuable). Une ligne par
  // signature individuelle ; un document peut en avoir N (demandeur,
  // trésorier, RG...). `tsa_response` reste NULL au MVP — champ prêt
  // pour un timestamping RFC 3161 ultérieur sans migration.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      signer_role TEXT NOT NULL,
      signer_user_id TEXT REFERENCES users(id),
      signer_email TEXT NOT NULL,
      signer_name TEXT,
      data_hash TEXT NOT NULL,
      previous_signature_id TEXT REFERENCES signatures(id),
      chain_hash TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      server_timestamp TEXT NOT NULL,
      tsa_response TEXT,
      tsa_timestamp TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signatures_doc ON signatures(document_type, document_id);
    CREATE INDEX IF NOT EXISTS idx_signatures_signer ON signatures(signer_user_id);
  `);

  ensured = true;
}
