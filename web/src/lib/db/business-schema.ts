import { getDb, type DbWrapper } from '../db';

let ensured = false;

// Définition canonique de la table `ecritures` dans sa **forme courante**
// (post-Task 5 du pivot miroir strict + MCP-first).
//
// Différences vs version historique :
//   - PAS de CHECK SQL sur `status` (validation côté code, cf. ADR-019
//     et AGENTS.md "CHECK SQL en général : à éviter pour les workflows").
//   - DEFAULT 'draft' (nouveau enum) au lieu de 'brouillon' (ancien).
//
// Le nouveau enum :
//   - draft         : préparation locale, jamais envoyé à CW
//   - pending_cw    : en cours d'envoi vers CW
//   - pending_sync  : envoyé à CW avec succès, attend la sync
//   - mirror        : synced, miroir CW propre
//   - divergent     : sync a détecté un écart
//
// Mapping migration anciens → nouveaux (cf. migrateEcrituresStatus) :
//   brouillon → draft ; valide → pending_sync ; saisie_comptaweb → mirror.
const ECRITURES_COLUMNS_DDL = `
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  unite_id TEXT REFERENCES unites(id),
  date_ecriture TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
  category_id TEXT REFERENCES categories(id),
  mode_paiement_id TEXT REFERENCES modes_paiement(id),
  activite_id TEXT REFERENCES activites(id),
  carte_id TEXT REFERENCES cartes(id),
  numero_piece TEXT,
  -- Task 7 pivot miroir strict : numéro de pièce renvoyé par Comptaweb
  -- après création réussie via le scraper (POST /recettedepense/nouveau).
  -- Sert d identifiant de matching pour la sync incrémentale (Phase 2)
  -- qui promouvra pending_sync vers mirror quand elle retrouvera
  -- l écriture côté CW. Distinct de numero_piece (saisi par le user /
  -- contenu dans l import CSV) -- peut être identique en pratique mais
  -- sémantiquement différent : l un est input/import, l autre est output
  -- direct du scraper. Index dédié : idx_ecritures_cw_numero_piece.
  cw_numero_piece TEXT,
  -- Réconciliation (spec 2026-06-01) : hash stable des champs liste CW
  -- (date, montant, type, intitulé, n°pièce, mode, catégorie tiers).
  -- Permet l'enrichissement détail INCRÉMENTAL : on ne relit la page
  -- détail CW (activité / branche) que si la signature a changé.
  -- Nullable, renseignée par le cycle de réconciliation.
  cw_signature TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  justif_attendu INTEGER NOT NULL DEFAULT 1,
  comptaweb_synced INTEGER NOT NULL DEFAULT 0,
  ligne_bancaire_id INTEGER,
  ligne_bancaire_sous_index INTEGER,
  comptaweb_ecriture_id INTEGER,
  -- Libellé bancaire BRUT figé à la génération d'un brouillon depuis une
  -- ligne bancaire (= description initiale, jamais réécrit). Sert à (a)
  -- détecter qu'un titre n'a pas encore été personnalisé (description ==
  -- libelle_origine → « à renommer »), (b) référence de rapprochement. Null
  -- pour les écritures saisies manuellement.
  libelle_origine TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
`;

// Liste explicite des colonnes copiées par la migration (utilisée dans
// INSERT INTO ... SELECT ...). DOIT correspondre aux colonnes définies
// dans `ECRITURES_COLUMNS_DDL`. Si on ajoute une colonne au CREATE TABLE
// par ailleurs (via ALTER TABLE ailleurs), pense à l'ajouter ici ET à
// vérifier qu'elle existe sur l'ancienne table avant migration (sinon
// SELECT plante).
const ECRITURES_COLUMNS_FOR_COPY = [
  'id',
  'group_id',
  'unite_id',
  'date_ecriture',
  'description',
  'amount_cents',
  'type',
  'category_id',
  'mode_paiement_id',
  'activite_id',
  'carte_id',
  'numero_piece',
  // status géré séparément via CASE WHEN pour le remap des valeurs
  // NB: cw_numero_piece et cw_signature sont ajoutés par ALTER (ensure*)
  // donc absents de l'ancienne table au moment d'une migration de statut.
  'justif_attendu',
  'comptaweb_synced',
  'ligne_bancaire_id',
  'ligne_bancaire_sous_index',
  'comptaweb_ecriture_id',
  'notes',
  'created_at',
  'updated_at',
] as const;

const ECRITURES_INDEXES_DDL = `
  CREATE INDEX IF NOT EXISTS idx_ecritures_group ON ecritures(group_id);
  CREATE INDEX IF NOT EXISTS idx_ecritures_unite ON ecritures(unite_id);
  CREATE INDEX IF NOT EXISTS idx_ecritures_date ON ecritures(date_ecriture);
  CREATE INDEX IF NOT EXISTS idx_ecritures_type ON ecritures(type);
  CREATE INDEX IF NOT EXISTS idx_ecritures_status ON ecritures(status);
  CREATE INDEX IF NOT EXISTS idx_ecritures_ligne_bancaire ON ecritures(ligne_bancaire_id, ligne_bancaire_sous_index);
  CREATE INDEX IF NOT EXISTS idx_ecritures_carte ON ecritures(carte_id);
  -- NB: idx_ecritures_cw_numero_piece est créé par ensureEcrituresCwNumeroPiece()
  -- APRÈS l'ALTER TABLE ADD COLUMN. Le mettre ici provoque un crash sur
  -- BDD existante (le CREATE TABLE IF NOT EXISTS est no-op et la colonne
  -- n'a pas encore été ajoutée). Cf. piège documenté dans web/AGENTS.md
  -- "CREATE INDEX doit venir APRÈS l'ALTER TABLE qui crée la colonne".
`;

/**
 * Migre la table `ecritures` du vieil enum statut (`brouillon` / `valide` /
 * `saisie_comptaweb`) vers le nouveau (`draft` / `pending_cw` /
 * `pending_sync` / `mirror` / `divergent`) ET retire la CHECK SQL qui
 * bloquait l'introduction de nouveaux statuts.
 *
 * Idempotent : détecte la présence de la CHECK ancienne dans
 * `sqlite_master` ; si elle n'est plus là, no-op.
 *
 * Préservation des données : INSERT recopie TOUTES les colonnes et
 * TOUTES les lignes (cf. règle CLAUDE.md "JAMAIS de DELETE"). Le DROP
 * + RENAME ne porte que sur la redéfinition de schéma.
 *
 * Exporté pour les tests (cf. business-schema-status-migration.test.ts).
 */
export async function migrateEcrituresStatus(db: DbWrapper): Promise<void> {
  const def = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ecritures'")
    .get<{ sql: string }>();

  if (!def?.sql) {
    // La table n'existe pas encore : rien à migrer.
    return;
  }

  // Détection : ancienne CHECK qui contraint `status` à
  // `brouillon` / `valide` / `saisie_comptaweb`. Match laxiste sur
  // 'saisie_comptaweb' qui est le marqueur le plus discriminant.
  const hasOldCheck =
    /CHECK\s*\(\s*status\s+IN\s*\([^)]*'saisie_comptaweb'/i.test(def.sql);
  if (!hasOldCheck) {
    return;
  }

  const copyCols = ECRITURES_COLUMNS_FOR_COPY.join(', ');
  // Remap des valeurs anciennes → nouvelles. Le CASE est exhaustif sur
  // les 3 valeurs autorisées par la vieille CHECK ; l'ELSE laisse passer
  // une éventuelle valeur inattendue plutôt que de la perdre (par ex.
  // une BDD bricolée à la main).
  const statusCase = `
    CASE status
      WHEN 'brouillon' THEN 'draft'
      WHEN 'valide' THEN 'pending_sync'
      WHEN 'saisie_comptaweb' THEN 'mirror'
      ELSE status
    END
  `;

  // PRAGMA foreign_keys OFF le temps du DROP+RENAME (pattern auth/schema.ts) :
  // les tables qui référencent ecritures(id) — remboursements, depots_*,
  // mouvements_caisse, depots_justificatifs, justificatifs — bloqueraient
  // le DROP sinon. On lit l'état initial pour le restaurer en finally
  // (au cas où l'appelant ait délibérément FK OFF — typique d'un test
  // isolé qui n'a pas créé les tables référencées).
  const fkRow = await db.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>();
  const fkWasOn = (fkRow?.foreign_keys ?? 0) === 1;
  await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.exec('DROP TABLE IF EXISTS ecritures_new');
    await db.exec(`
      CREATE TABLE ecritures_new (
        ${ECRITURES_COLUMNS_DDL}
      );
      INSERT INTO ecritures_new (${copyCols}, status)
        SELECT ${copyCols}, ${statusCase} FROM ecritures;
      DROP TABLE ecritures;
      ALTER TABLE ecritures_new RENAME TO ecritures;
    `);
    await db.exec(ECRITURES_INDEXES_DDL);
  } finally {
    if (fkWasOn) {
      await db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// Schéma des tables métier (référentiels, annuaire, ecritures,
// remboursements, etc.) dans leur forme **courante** : on intègre
// directement les colonnes qui ont été ajoutées par ALTER TABLE au fil
// des chantiers, et on omet les CHECK qui ont été retirées (cf. ADR-019
// pour `users.role`, refonte rembs P2-workflows pour `remboursements.
// status`).
//
// Idempotent : tous les CREATE sont en `IF NOT EXISTS`. Sur la BDD
// prod existante, l'appel est un no-op. Sur une BDD vierge (premier
// déploiement, environnement de test, futur 2e groupe), c'est ce qui
// fait exister les tables — l'ancien `compta/src/schema.sql` a été
// supprimé au chantier 6 sans être ré-introduit côté web.
//
// Les tables d'auth (sessions, verification_tokens, signin_attempts,
// api_tokens) et les tables ajoutées tardivement (remboursement_lignes,
// signatures) restent gérées par `auth/schema.ts` — pour ne pas
// dupliquer ; cette fonction est appelée en amont.
export async function ensureBusinessSchema(): Promise<void> {
  if (ensured) return;
  const db = getDb();

  await db.exec(`
    -- ============ Référentiels =================================
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'les_deux' CHECK(type IN ('depense', 'recette', 'les_deux')),
      comptaweb_nature TEXT,
      comptaweb_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS modes_paiement (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      comptaweb_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    -- unites = vraies unités SGDF du groupe (1 ligne Comptaweb "branche/
    -- projet" = 1 unité). Plusieurs unités peuvent partager la même
    -- branche d'âge (ex: 2 groupes de Louveteaux LJ-1 et LJ-2 sont 2
    -- unités distinctes mais même branche LJ).
    -- La colonne 'branche' (FA / LJ / SG / PC / CO / AD / AJ) est ajoutée
    -- par auth/schema.ts via ALTER (le CREATE TABLE IF NOT EXISTS étant
    -- un no-op sur les BDDs déjà déployées).
    CREATE TABLE IF NOT EXISTS unites (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      comptaweb_id INTEGER,
      couleur TEXT,
      branche TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS activites (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      comptaweb_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS cartes (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('cb', 'procurement')),
      porteur TEXT NOT NULL,
      comptaweb_id INTEGER,
      code_externe TEXT,
      statut TEXT NOT NULL DEFAULT 'active' CHECK(statut IN ('active', 'ancienne')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cartes_group ON cartes(group_id);
    CREATE INDEX IF NOT EXISTS idx_cartes_comptaweb ON cartes(comptaweb_id);
    CREATE INDEX IF NOT EXISTS idx_cartes_code ON cartes(code_externe);

    -- ============ Annuaire ====================================
    CREATE TABLE IF NOT EXISTS groupes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      territoire TEXT,
      adresse TEXT,
      email_contact TEXT,
      iban_principal TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS personnes (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      prenom TEXT NOT NULL,
      nom TEXT,
      email TEXT,
      telephone TEXT,
      role_groupe TEXT,
      unite_id TEXT REFERENCES unites(id),
      statut TEXT NOT NULL DEFAULT 'actif' CHECK(statut IN ('actif', 'ancien', 'inactif')),
      depuis TEXT,
      jusqu_a TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_personnes_group ON personnes(group_id);
    CREATE INDEX IF NOT EXISTS idx_personnes_unite ON personnes(unite_id);
    CREATE INDEX IF NOT EXISTS idx_personnes_role ON personnes(role_groupe);

    -- users : pas de CHECK sur \`role\` (cf. ADR-019, validation en code).
    -- email_verified inclus directement (était un ALTER post-MVP).
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      person_id TEXT REFERENCES personnes(id),
      email TEXT NOT NULL,
      nom_affichage TEXT,
      role TEXT NOT NULL,
      scope_unite_id TEXT REFERENCES unites(id),
      statut TEXT NOT NULL DEFAULT 'actif' CHECK(statut IN ('actif', 'suspendu', 'invite', 'ancien')),
      email_verified TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(group_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);
    CREATE INDEX IF NOT EXISTS idx_users_person ON users(person_id);

    -- ============ Métier ======================================
    -- ecritures : colonnes étendues (justif_attendu, ligne_bancaire_*,
    -- comptaweb_ecriture_id, carte_id) intégrées en CREATE.
    --
    -- Task 5 du pivot miroir strict : pas de CHECK sur status (workflow
    -- validé côté code), enum draft/pending_cw/pending_sync/mirror/divergent.
    -- DDL canonique dans ECRITURES_COLUMNS_DDL (réutilisé par la
    -- migration). Pour les BDDs vierges, ce CREATE applique direct la
    -- forme courante ; pour les BDDs existantes (ancienne CHECK), c'est
    -- migrateEcrituresStatus() ci-dessous qui prend le relais.
    CREATE TABLE IF NOT EXISTS ecritures (
      ${ECRITURES_COLUMNS_DDL}
    );
    ${ECRITURES_INDEXES_DDL}

    -- remboursements : version moderne (P2-workflows 2-bis), pas de
    -- CHECK sur \`status\`, champs valdesous (prenom/nom/email/rib_*),
    -- total_cents, motif_refus, edit_token, validate_token,
    -- submitted_by_user_id.
    CREATE TABLE IF NOT EXISTS remboursements (
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
    CREATE INDEX IF NOT EXISTS idx_rbt_group ON remboursements(group_id);
    CREATE INDEX IF NOT EXISTS idx_rbt_status ON remboursements(status);
    CREATE INDEX IF NOT EXISTS idx_rbt_demandeur ON remboursements(demandeur);
    CREATE INDEX IF NOT EXISTS idx_rbt_edit_token ON remboursements(edit_token);
    CREATE INDEX IF NOT EXISTS idx_rbt_validate_token ON remboursements(validate_token);

    -- abandons_frais : avec submitted_by_user_id, status (workflow
    -- a_traiter / valide / envoye_national + refuse), motif_refus,
    -- prenom + nom + email pour identifier le donateur. Le champ
    -- donateur reste rempli pour rétrocompat.
    CREATE TABLE IF NOT EXISTS abandons_frais (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      donateur TEXT NOT NULL,
      prenom TEXT,
      nom TEXT,
      email TEXT,
      amount_cents INTEGER NOT NULL,
      date_depense TEXT NOT NULL,
      nature TEXT NOT NULL,
      unite_id TEXT REFERENCES unites(id),
      annee_fiscale TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'a_traiter',
      motif_refus TEXT,
      sent_to_national_at TEXT,
      cerfa_emis INTEGER NOT NULL DEFAULT 0,
      cerfa_emis_at TEXT,
      notes TEXT,
      submitted_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_abandons_group ON abandons_frais(group_id);
    CREATE INDEX IF NOT EXISTS idx_abandons_annee ON abandons_frais(annee_fiscale);
    -- idx_abandons_status est créé dans auth/schema.ts APRÈS l ALTER
    -- TABLE qui ajoute la colonne status aux BDDs existantes : sinon
    -- ce CREATE INDEX plante sur les BDDs pré-migration (CREATE TABLE
    -- IF NOT EXISTS étant un no-op, la colonne n est pas encore là).

    -- mouvements_caisse : avec unite_id, activite_id, et workflow espèces
    -- intégré (type, numero_piece, status, depot_id pour les sorties qui
    -- sont des dépôts en banque). Pas de CHECK sur status (cf. AGENTS.md).
    CREATE TABLE IF NOT EXISTS mouvements_caisse (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date_mouvement TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      type TEXT,
      numero_piece TEXT,
      status TEXT NOT NULL DEFAULT 'saisi',
      depot_id TEXT,
      airtable_id TEXT,
      comptaweb_ecriture_id INTEGER,
      archived_at TEXT,
      solde_apres_cents INTEGER,
      unite_id TEXT REFERENCES unites(id),
      activite_id TEXT REFERENCES activites(id),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mvt_caisse_group ON mouvements_caisse(group_id);
    -- Les index sur status/depot_id/airtable_id sont créés dans
    -- auth/schema.ts APRÈS l'ALTER TABLE qui ajoute ces colonnes
    -- (cf. AGENTS.md : CREATE TABLE IF NOT EXISTS = no-op sur BDD
    -- existante, donc les nouvelles colonnes ne sont pas créées par ce
    -- bloc — le CREATE INDEX planterait sur "no such column").

    -- depots_especes : transfert d'espèces caisse → banque. Symétrique
    -- de depots_cheques. Lien vers l'écriture banque correspondante
    -- (rapprochement Comptaweb).
    CREATE TABLE IF NOT EXISTS depots_especes (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date_depot TEXT NOT NULL,
      total_amount_cents INTEGER NOT NULL,
      detail_billets TEXT,
      ecriture_id TEXT REFERENCES ecritures(id),
      airtable_id TEXT,
      notes TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_depots_especes_group ON depots_especes(group_id);
    CREATE INDEX IF NOT EXISTS idx_depots_especes_ecriture ON depots_especes(ecriture_id);
    CREATE INDEX IF NOT EXISTS idx_depots_especes_airtable ON depots_especes(airtable_id);

    CREATE TABLE IF NOT EXISTS depots_cheques (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date_depot TEXT NOT NULL,
      type_depot TEXT NOT NULL CHECK(type_depot IN ('banque', 'ancv')),
      total_amount_cents INTEGER NOT NULL,
      nombre_cheques INTEGER NOT NULL DEFAULT 1,
      detail_cheques TEXT,
      confirmation_status TEXT NOT NULL DEFAULT 'en_attente' CHECK(confirmation_status IN ('en_attente', 'confirme')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    -- depots_justificatifs : workflow chantier 1 (un user dépose un
    -- justif libre, le tresorier le rapproche d'une écriture).
    -- Statut sans CHECK SQL (workflow validé côté code, cf. ADR-019/022).
    -- Présence ici (et pas seulement en lazy-init dans services/depots.ts)
    -- pour que nextId('DEP') puisse interroger la table dès le boot.
    CREATE TABLE IF NOT EXISTS depots_justificatifs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
      titre TEXT NOT NULL,
      description TEXT,
      category_id TEXT REFERENCES categories(id),
      unite_id TEXT REFERENCES unites(id),
      amount_cents INTEGER,
      date_estimee TEXT,
      carte_id TEXT REFERENCES cartes(id),
      statut TEXT NOT NULL DEFAULT 'a_traiter',
      ecriture_id TEXT REFERENCES ecritures(id),
      remboursement_id TEXT REFERENCES remboursements(id),
      motif_rejet TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_depots_group_statut ON depots_justificatifs(group_id, statut);
    CREATE INDEX IF NOT EXISTS idx_depots_submitter ON depots_justificatifs(submitted_by_user_id);

    -- Journal d'erreurs applicatives. Alimenté par logError() en
    -- fire-and-forget : si la BDD plante, l'erreur est juste loguée
    -- en console (pas de récursion). Page admin /admin/errors pour
    -- consulter sans avoir à passer par les logs Vercel.
    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      mod TEXT NOT NULL,
      message TEXT NOT NULL,
      error_name TEXT,
      stack TEXT,
      data_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      resolved_at TEXT,
      resolved_by TEXT REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_error_log_unresolved ON error_log(resolved_at)
      WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_error_log_mod ON error_log(mod);

    CREATE TABLE IF NOT EXISTS justificatifs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_just_entity ON justificatifs(entity_type, entity_id);

    -- ============ Mémoire ====================================
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      user_id TEXT REFERENCES users(id),
      topic TEXT NOT NULL,
      title TEXT,
      content_md TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notes_group ON notes(group_id);
    CREATE INDEX IF NOT EXISTS idx_notes_topic ON notes(group_id, topic);

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      user_id TEXT REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'en_cours' CHECK(status IN ('en_cours', 'bientot', 'fait', 'annule', 'recurrent')),
      due_date TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_todos_group ON todos(group_id);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
    CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_date);

    -- ============ Comptes & budgets ==========================
    CREATE TABLE IF NOT EXISTS comptes_bancaires (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      code TEXT NOT NULL,
      nom TEXT NOT NULL,
      banque TEXT,
      iban TEXT,
      bic TEXT,
      type_compte TEXT CHECK(type_compte IN ('courant', 'livret', 'caisse', 'autre')),
      comptaweb_id INTEGER,
      statut TEXT NOT NULL DEFAULT 'actif' CHECK(statut IN ('actif', 'ferme')),
      ouvert_le TEXT,
      ferme_le TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comptes_group ON comptes_bancaires(group_id);

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      saison TEXT NOT NULL,
      statut TEXT NOT NULL DEFAULT 'projet' CHECK(statut IN ('projet', 'vote', 'cloture')),
      vote_le TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(group_id, saison)
    );

    CREATE TABLE IF NOT EXISTS budget_lignes (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL REFERENCES budgets(id),
      unite_id TEXT REFERENCES unites(id),
      category_id TEXT REFERENCES categories(id),
      activite_id TEXT REFERENCES activites(id),
      libelle TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
      amount_cents INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_budget_lignes_budget ON budget_lignes(budget_id);
    CREATE INDEX IF NOT EXISTS idx_budget_lignes_unite ON budget_lignes(unite_id);
    -- idx_budget_lignes_activite est créé dans auth/schema.ts APRÈS l'ALTER
    -- TABLE qui ajoute activite_id aux BDDs existantes (cf. AGENTS.md :
    -- CREATE TABLE IF NOT EXISTS = no-op sur BDD existante).

    -- ============ Répartitions entre unités (phase 3) ===========
    -- Mouvement Baloo-only qui déplace un montant d'une unité source
    -- vers une unité cible. NULL côté source ou cible = "Groupe"
    -- (pot commun). Pas de flux Comptaweb.
    -- Validation source != cible côté code (pas de CHECK SQL —
    -- cf. ADR-019 et convention 'workflow en code, pas en BDD').
    CREATE TABLE IF NOT EXISTS repartitions_unites (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      date_repartition TEXT NOT NULL,
      saison TEXT NOT NULL,
      montant_cents INTEGER NOT NULL,
      unite_source_id TEXT REFERENCES unites(id),
      unite_cible_id TEXT REFERENCES unites(id),
      libelle TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_repartitions_group_saison ON repartitions_unites(group_id, saison);
    CREATE INDEX IF NOT EXISTS idx_repartitions_source ON repartitions_unites(unite_source_id);
    CREATE INDEX IF NOT EXISTS idx_repartitions_cible ON repartitions_unites(unite_cible_id);

    -- ============ Comptaweb (import / rapprochement) =========
    CREATE TABLE IF NOT EXISTS comptaweb_imports (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      import_date TEXT NOT NULL,
      source_file TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      total_depenses_cents INTEGER,
      total_recettes_cents INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS comptaweb_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id TEXT NOT NULL REFERENCES comptaweb_imports(id),
      date_ecriture TEXT,
      intitule TEXT,
      depense_cents INTEGER,
      recette_cents INTEGER,
      mode_transaction TEXT,
      type_ligne TEXT,
      nature TEXT,
      activite TEXT,
      branche TEXT,
      numero_piece TEXT,
      raw_data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cwl_import ON comptaweb_lignes(import_id);

    -- ============ OAuth 2.0 Authorization Server (RFC 6749 + PKCE) ==
    -- Spec de reference : doc/plans/2026-05-12-mcp-http-oauth-design.md
    -- Tokens stockes en hash SHA-256 en BDD (jamais en clair).
    -- Pas de CHECK SQL sur les colonnes de workflow (doctrine ADR-019).

    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL UNIQUE,
      client_name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id);
  `);

  // Task 1 Phase 2 : table d'audit `sync_runs` pour le sync incrémental
  // Comptaweb (cf. specs/2026-05-19-baloo-sync-incremental-design.md).
  // Extraite en fonction pour être testable isolément.
  await ensureSyncRunsSchema(db);

  // Task 5 pivot miroir strict : migration du statut `ecritures` vers
  // le nouvel enum (draft/pending_cw/pending_sync/mirror/divergent) et
  // suppression de la CHECK SQL. Idempotent : no-op si déjà migré.
  await migrateEcrituresStatus(db);

  // Task 7 pivot miroir strict : ajout de la colonne `cw_numero_piece`
  // pour stocker le numéro de pièce renvoyé par Comptaweb après création
  // réussie via le scraper. Idempotent.
  await ensureEcrituresCwNumeroPiece(db);

  // Réconciliation Comptaweb (spec 2026-06-01) : cw_signature, compteurs
  // sync_runs, table cw_link_suggestions, backfill comptaweb_ecriture_id.
  // APRÈS ensureSyncRunsSchema + ensureEcrituresCwNumeroPiece (dépend des
  // colonnes/table créées plus haut).
  await ensureReconcileSchema(db);

  // Titres parlants (spec 2026-06-30) : colonne libelle_origine + backfill
  // ciblé des brouillons bancaires encore bruts. APRÈS la table ecritures.
  await ensureEcrituresLibelleOrigine(db);

  // Recettes sans justif attendu (demande terrain 2026-06-30) : une entrée
  // d'argent n'attend pas de justificatif.
  await ensureRecettesSansJustifAttendu(db);

  ensured = true;
}

/**
 * Une entrée d'argent (recette) n'attend pas de justificatif (demande terrain
 * 2026-06-30). Repasse `justif_attendu = 0` sur les recettes qui le portent
 * encore à 1, SAUF celles qui ont réellement un justif attaché (là, la pièce
 * existe → on n'y touche pas). Idempotente : ré-applique l'invariant à froid.
 */
export async function ensureRecettesSansJustifAttendu(db: DbWrapper): Promise<void> {
  const cols = await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>();
  if (cols.length === 0) return;
  await db.exec(`
    UPDATE ecritures
    SET justif_attendu = 0
    WHERE type = 'recette'
      AND justif_attendu = 1
      AND NOT EXISTS (
        SELECT 1 FROM justificatifs j
        WHERE j.entity_type = 'ecriture' AND j.entity_id = ecritures.id
      )
  `);
}

/**
 * Titres parlants pour les écritures bancaires (spec
 * doc/superpowers/specs/2026-06-30-titres-ecritures-bancaires-design.md).
 * Idempotente. Sur BDD existante :
 *   - ajoute `ecritures.libelle_origine` (ALTER, nullable) ;
 *   - backfill CIBLÉ : pose `libelle_origine = description` sur les BROUILLONS
 *     bancaires (`status='draft'`, `ligne_bancaire_id` non nul) dont la
 *     description ressemble encore à un libellé bancaire brut. Conservateur :
 *     n'écrase jamais un libelle_origine déjà posé, épargne les titres déjà
 *     soignés et les écritures déjà dans CW (mirror — non renommables localement).
 *
 * Pattern AGENTS.md : ALTER ADD COLUMN après détection PRAGMA.
 * Exporté pour les tests.
 */
export async function ensureEcrituresLibelleOrigine(db: DbWrapper): Promise<void> {
  const cols = await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>();
  if (cols.length === 0) return; // table pas encore créée (BDD vierge : CREATE l'inclut)
  if (!cols.some((c) => c.name === 'libelle_origine')) {
    await db.exec('ALTER TABLE ecritures ADD COLUMN libelle_origine TEXT');
  }
  // LIKE est insensible à la casse (ASCII) en SQLite : marqueurs bancaires
  // fréquents. On reste conservateur — mieux vaut rater un brut que marquer
  // « à renommer » un titre déjà personnalisé.
  await db.exec(`
    UPDATE ecritures
    SET libelle_origine = description
    WHERE libelle_origine IS NULL
      AND status = 'draft'
      AND ligne_bancaire_id IS NOT NULL
      AND (
        description LIKE '%PAIEMENT%'
        OR description LIKE '%C. PROC%'
        OR description LIKE '%FR FRANCE%'
        OR description LIKE 'VIR %'
        OR description LIKE '% VIR %'
      )
  `);
}

/**
 * Ajoute la colonne `cw_numero_piece` à `ecritures` si absente (BDDs déjà
 * migrées vers le nouvel enum statut mais antérieures à Task 7). Crée
 * aussi l'index `idx_ecritures_cw_numero_piece` utilisé par la sync
 * incrémentale (Phase 2) pour matcher `pending_sync` ↔ écriture CW.
 *
 * Pattern d'extension cf. AGENTS.md : `ALTER TABLE ADD COLUMN` après
 * détection via `PRAGMA table_info`, puis `CREATE INDEX IF NOT EXISTS`.
 * Nullable (pas de DEFAULT) : la valeur est renseignée par le service
 * `createEcritureAndPushToCw` au succès du scraping CW.
 *
 * Exporté pour les tests.
 */
export async function ensureEcrituresCwNumeroPiece(db: DbWrapper): Promise<void> {
  const cols = await db
    .prepare("PRAGMA table_info(ecritures)")
    .all<{ name: string }>();
  if (cols.length === 0) {
    // Table absente : on laisse ensureBusinessSchema la créer plus tard
    // avec la nouvelle colonne déjà au CREATE.
    return;
  }
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has('cw_numero_piece')) {
    await db.exec('ALTER TABLE ecritures ADD COLUMN cw_numero_piece TEXT');
  }
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ecritures_cw_numero_piece ON ecritures(cw_numero_piece)',
  );
}

/**
 * Crée la table d'audit `sync_runs` + index (group_id, started_at DESC)
 * si absente. Une ligne par cycle de sync incrémental Comptaweb (trigger
 * 'client' header, 'mcp', ou 'manual'). Statuts portés en TS : 'running'
 * (expire à 60s), 'ok', 'failed', 'skipped' (throttled / already_running).
 * Pas de CHECK SQL (cf. AGENTS.md : validation côté code).
 *
 * Idempotent. Exporté pour les tests de schéma.
 */
export async function ensureSyncRunsSchema(db: DbWrapper): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      promoted_to_mirror INTEGER NOT NULL DEFAULT 0,
      new_drafts INTEGER NOT NULL DEFAULT 0,
      updated_drafts INTEGER NOT NULL DEFAULT 0,
      divergent_detected INTEGER NOT NULL DEFAULT 0,
      -- Réconciliation (spec 2026-06-01) : compteurs du cycle miroir descendant.
      updated_mirror INTEGER NOT NULL DEFAULT 0,
      supprimee_cw_detected INTEGER NOT NULL DEFAULT 0,
      imported_from_cw INTEGER NOT NULL DEFAULT 0,
      link_suggestions_created INTEGER NOT NULL DEFAULT 0,
      detail_fetches INTEGER NOT NULL DEFAULT 0,
      scope TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_group_started
      ON sync_runs(group_id, started_at DESC);
  `);
}

/**
 * Migration de réconciliation (spec doc/specs/2026-06-01-sync-reconciliation-design.md).
 * Idempotente. Sur BDD existante :
 *   - ajoute `ecritures.cw_signature` (ALTER, nullable) ;
 *   - ajoute les compteurs + `scope` à `sync_runs` (ALTER, DEFAULT 0/NULL) ;
 *   - crée la table `cw_link_suggestions` + index (group_id, status) ;
 *   - backfill `comptaweb_ecriture_id` depuis `cw_numero_piece` numérique
 *     (Phase 1 y stockait String(id)) — sans écraser un id déjà posé.
 *
 * Pattern AGENTS.md : ALTER ADD COLUMN après détection PRAGMA, CREATE INDEX
 * après l'ALTER. Doit tourner APRÈS ensureSyncRunsSchema + ensureEcrituresCwNumeroPiece.
 *
 * Exporté pour les tests.
 */
export async function ensureReconcileSchema(db: DbWrapper): Promise<void> {
  // 1. ecritures.cw_signature
  const ecoCols = await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>();
  if (ecoCols.length > 0 && !ecoCols.some((c) => c.name === 'cw_signature')) {
    await db.exec('ALTER TABLE ecritures ADD COLUMN cw_signature TEXT');
  }

  // 2. nouvelles colonnes sync_runs (la table existe : ensureSyncRunsSchema avant)
  const srCols = await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>();
  if (srCols.length > 0) {
    const srHas = (n: string) => srCols.some((c) => c.name === n);
    const intCols = [
      'updated_mirror',
      'supprimee_cw_detected',
      'imported_from_cw',
      'link_suggestions_created',
      'detail_fetches',
    ];
    for (const col of intCols) {
      if (!srHas(col)) {
        // Nullable + backfill plutôt que NOT NULL DEFAULT (cf. AGENTS.md
        // libsql remote refuse parfois NOT NULL DEFAULT en ALTER).
        await db.exec(`ALTER TABLE sync_runs ADD COLUMN ${col} INTEGER DEFAULT 0`);
        await db.exec(`UPDATE sync_runs SET ${col} = 0 WHERE ${col} IS NULL`);
      }
    }
    if (!srHas('scope')) {
      await db.exec('ALTER TABLE sync_runs ADD COLUMN scope TEXT');
    }
  }

  // 3. table cw_link_suggestions + index
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cw_link_suggestions (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      ecriture_id TEXT NOT NULL,
      cw_ecriture_id INTEGER NOT NULL,
      cw_numero_piece TEXT,
      cw_montant_cents INTEGER,
      cw_date TEXT,
      cw_intitule TEXT,
      status TEXT NOT NULL DEFAULT 'a_confirmer',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cw_link_suggestions_group_status
      ON cw_link_suggestions(group_id, status);
  `);

  // 4. backfill comptaweb_ecriture_id depuis cw_numero_piece numérique.
  // GLOB '[0-9]*' = commence par un chiffre ; NOT GLOB '*[^0-9]*' = que des
  // chiffres. COALESCE implicite via WHERE comptaweb_ecriture_id IS NULL :
  // on ne touche jamais un id déjà renseigné.
  if (ecoCols.length > 0) {
    await db.exec(`
      UPDATE ecritures
      SET comptaweb_ecriture_id = CAST(cw_numero_piece AS INTEGER)
      WHERE comptaweb_ecriture_id IS NULL
        AND cw_numero_piece IS NOT NULL
        AND cw_numero_piece GLOB '[0-9]*'
        AND NOT cw_numero_piece GLOB '*[^0-9]*'
    `);
  }
}
