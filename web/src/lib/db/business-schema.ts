import { getDb } from '../db';

let ensured = false;

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
    CREATE TABLE IF NOT EXISTS ecritures (
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
      status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon', 'valide', 'saisie_comptaweb')),
      justif_attendu INTEGER NOT NULL DEFAULT 1,
      comptaweb_synced INTEGER NOT NULL DEFAULT 0,
      ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER,
      comptaweb_ecriture_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ecritures_group ON ecritures(group_id);
    CREATE INDEX IF NOT EXISTS idx_ecritures_unite ON ecritures(unite_id);
    CREATE INDEX IF NOT EXISTS idx_ecritures_date ON ecritures(date_ecriture);
    CREATE INDEX IF NOT EXISTS idx_ecritures_type ON ecritures(type);
    CREATE INDEX IF NOT EXISTS idx_ecritures_status ON ecritures(status);
    CREATE INDEX IF NOT EXISTS idx_ecritures_ligne_bancaire ON ecritures(ligne_bancaire_id, ligne_bancaire_sous_index);
    CREATE INDEX IF NOT EXISTS idx_ecritures_carte ON ecritures(carte_id);

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
  `);

  ensured = true;
}
