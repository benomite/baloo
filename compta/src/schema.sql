-- Schéma baloo-compta — compatible SQLite et Postgres (SQL standard)
-- Montants en centimes (INTEGER), dates en TEXT ISO 8601, IDs humains en TEXT

-- =============================================================================
-- TABLES DE RÉFÉRENCE
-- =============================================================================

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

CREATE TABLE IF NOT EXISTS unites (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    comptaweb_id INTEGER,
    -- Couleur officielle de la branche SGDF (hex). Permet un affichage
    -- graphique cohérent dans toutes les vues. Nullable : les unités locales
    -- sans équivalent branche (Groupe, AJUSTEMENTS…) peuvent rester sans.
    couleur TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS activites (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    comptaweb_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Cartes bancaires (CB classiques) et cartes procurement (CB pré-chargées SGDF)
-- utilisées par le groupe. Le code_externe n'est renseigné que pour les
-- procurements : il apparaît dans les intitulés bancaires des paiements
-- (ex: "PAIEMENT C. PROC P168XLW4O") et permet d'inférer automatiquement la
-- carte au moment du scan des drafts. Les CB classiques n'ont généralement
-- pas de code identifiable dans l'intitulé, d'où le sélecteur manuel dans
-- le form d'édition pour ce mode-là.
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

-- =============================================================================
-- TABLES MÉTIER
-- =============================================================================

-- Journal des écritures (remplace Google Sheet "Compta Unités")
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
    numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon', 'valide', 'saisie_comptaweb')),
    -- 1 = justif requis (défaut). 0 = justif non attendu (prélèvement auto SGDF,
    -- flux territoire, etc.) : n'apparaît plus dans l'alerte 'sans justif' et
    -- la sync Comptaweb ne l'exige pas. Quand = 1 et aucun fichier attaché,
    -- l'écriture reste signalée "à compléter" ; numero_piece permet la sync
    -- sans éteindre l'alerte tant que le fichier n'est pas rattaché.
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    -- Lien vers la ligne bancaire Comptaweb d'origine (quand l'écriture a été
    -- générée en draft depuis le rapprochement bancaire). sous_index pointe
    -- sur la sous-ligne DSP2 éventuelle.
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    -- ID numérique Comptaweb de l'écriture après synchro (null tant que draft).
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
-- idx_ecritures_ligne_bancaire est créé par migrate() dans db.ts après le
-- ADD COLUMN, pour les installs existantes qui n'avaient pas ces colonnes.

-- Remboursements (remplace Airtable "Remboursements")
CREATE TABLE IF NOT EXISTS remboursements (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    demandeur TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    date_depense TEXT NOT NULL,
    nature TEXT NOT NULL,
    unite_id TEXT REFERENCES unites(id),
    justificatif_status TEXT NOT NULL DEFAULT 'en_attente' CHECK(justificatif_status IN ('oui', 'en_attente', 'non')),
    status TEXT NOT NULL DEFAULT 'demande' CHECK(status IN ('demande', 'valide', 'paye', 'refuse')),
    date_paiement TEXT,
    mode_paiement_id TEXT REFERENCES modes_paiement(id),
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ecriture_id TEXT REFERENCES ecritures(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_rbt_group ON remboursements(group_id);
CREATE INDEX IF NOT EXISTS idx_rbt_status ON remboursements(status);
CREATE INDEX IF NOT EXISTS idx_rbt_demandeur ON remboursements(demandeur);

-- Abandons de frais (remplace Airtable "Abandons de frais")
CREATE TABLE IF NOT EXISTS abandons_frais (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    donateur TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    date_depense TEXT NOT NULL,
    nature TEXT NOT NULL,
    unite_id TEXT REFERENCES unites(id),
    annee_fiscale TEXT NOT NULL,
    cerfa_emis INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Mouvements de caisse (remplace Airtable "Caisse (monnaie)")
CREATE TABLE IF NOT EXISTS mouvements_caisse (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    date_mouvement TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    solde_apres_cents INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Dépôts de chèques (remplace Airtable chèques banque + ANCV)
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

-- Justificatifs (remplace Drive pour le stockage des pièces)
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

-- =============================================================================
-- TABLES MULTI-USER / MULTI-TENANT (ADR-013, ajoutées 2026-04-18)
-- =============================================================================
-- Ces tables préparent le multi-user et la migration de mon-groupe/*.md vers la BDD.
-- Non peuplées, non utilisées au MVP : elles existent pour que le schéma soit prêt
-- le jour où un 2e user concret arrive, et pour que les migrations fichier par
-- fichier puissent s'y appuyer progressivement.
--
-- Note : les tables métier (ecritures, remboursements, ...) utilisent group_id
-- sans DEFAULT : chaque INSERT doit passer le group_id explicite (récupéré via
-- getCurrentContext() dans les tools). La foreign key vers groupes(id) pourra
-- être ajoutée quand toutes les installations auront été migrées proprement.

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

-- Annuaire du groupe : chefs, bénévoles, parents, jeunes inscrits. Pas
-- forcément des users Baloo (un parent qui paye n'a pas nécessairement un
-- compte Baloo).
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

-- Comptes Baloo : authentification + rôle + scope d'accès.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groupes(id),
    person_id TEXT REFERENCES personnes(id),
    email TEXT NOT NULL,
    nom_affichage TEXT,
    role TEXT NOT NULL CHECK(role IN ('tresorier', 'cotresorier', 'chef_unite', 'parent', 'membre_autre_groupe')),
    scope_unite_id TEXT REFERENCES unites(id),
    statut TEXT NOT NULL DEFAULT 'actif' CHECK(statut IN ('actif', 'suspendu', 'invite', 'ancien')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(group_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);
CREATE INDEX IF NOT EXISTS idx_users_person ON users(person_id);

-- Credentials externes (Comptaweb, etc.) par user. Non chiffrés au MVP
-- (cf. ADR-013 : chiffrement remis à plus tard, ADR dédié).
CREATE TABLE IF NOT EXISTS user_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE(user_id, provider, kind)
);

CREATE INDEX IF NOT EXISTS idx_user_creds_user ON user_credentials(user_id);

-- Préférences user (clé-valeur).
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY(user_id, key)
);

-- Notes libres (remplace les sections "notes" des anciens markdowns
-- mon-groupe/asso.md, finances.md, outils.md, etc.). Consommables par le
-- LLM pour garder le contexte.
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

-- Todos (remplace mon-groupe/todo.md).
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

-- Comptes bancaires du groupe (remplace mon-groupe/comptes.md).
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

-- Budgets annuels + lignes (remplace mon-groupe/budgets/ + finances.md).
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
    libelle TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
    amount_cents INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_budget_lignes_budget ON budget_lignes(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_lignes_unite ON budget_lignes(unite_id);

-- =============================================================================
-- TABLES COMPTAWEB (pour import/rapprochement)
-- =============================================================================

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
