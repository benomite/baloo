import { getDb } from '../db';
import { currentTimestamp, nextId } from '../ids';
import { attachJustificatif } from './justificatifs';

// Service de dépôt de justificatif libre (chantier 1, ADR à venir).
//
// Un user authentifié (sauf `parent`) dépose un justif avec quelques
// métadonnées. Le dépôt vit indépendamment des écritures pour éviter les
// doublons avec les brouillons générés par le rapprochement Comptaweb.
//
// Cycle de vie : `a_traiter` → `rattache` (à une écriture) ou `rejete`.
// Quand on rattache, le file justif migre de `entity_type='depot'` vers
// `entity_type='ecriture'` pour rester lisible par les services existants.

let schemaEnsured = false;

export async function ensureDepotsSchema(): Promise<void> {
  if (schemaEnsured) return;
  const db = getDb();
  await db.exec(`
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
      motif_rejet TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_depots_group_statut ON depots_justificatifs(group_id, statut);
    CREATE INDEX IF NOT EXISTS idx_depots_submitter ON depots_justificatifs(submitted_by_user_id);
  `);
  // Migration camps (spec 2026-06-10) : rattachement d'un dépôt à une
  // activité (le camp retrouve ses dépôts via son activite_id).
  const depotCols = await db.prepare(`PRAGMA table_info(depots_justificatifs)`).all<{ name: string }>();
  if (!depotCols.some((c) => c.name === 'activite_id')) {
    await db.exec(`ALTER TABLE depots_justificatifs ADD COLUMN activite_id TEXT REFERENCES activites(id);`);
  }
  schemaEnsured = true;
}

export const DEPOT_STATUTS = ['a_traiter', 'rattache', 'rejete'] as const;
export type DepotStatut = (typeof DEPOT_STATUTS)[number];

export interface Depot {
  id: string;
  group_id: string;
  submitted_by_user_id: string;
  titre: string;
  description: string | null;
  category_id: string | null;
  unite_id: string | null;
  amount_cents: number | null;
  date_estimee: string | null;
  carte_id: string | null;
  activite_id: string | null;
  statut: DepotStatut;
  ecriture_id: string | null;
  motif_rejet: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepotEnriched extends Depot {
  submitter_name: string | null;
  submitter_email: string;
  unite_code: string | null;
  category_name: string | null;
  carte_label: string | null;
  // Chemin du justif le plus récent (compat) + liste complète (séparée
  // par des sauts de ligne, impossibles dans un nom de fichier) et leur
  // nombre, pour afficher tous les fichiers d'un dépôt.
  justif_path: string | null;
  justif_paths: string | null;
  justif_count: number;
}

// Découpe la colonne agrégée `justif_paths` en liste de chemins.
export function splitJustifPaths(paths: string | null): string[] {
  if (!paths) return [];
  return paths.split('\n').filter((p) => p.length > 0);
}

export interface DepotsContext {
  groupId: string;
  userId: string;
}

export interface CreateDepotInput {
  titre: string;
  description?: string | null;
  category_id?: string | null;
  unite_id?: string | null;
  amount_cents?: number | null;
  date_estimee?: string | null;
  carte_id?: string | null;
  activite_id?: string | null;
  // Fichiers joints (au moins un, obligatoire à la création). Un même
  // dépôt peut regrouper plusieurs pièces (ticket + facture, recto/verso,
  // pages multiples…).
  files: {
    filename: string;
    content: Buffer;
    mime_type?: string | null;
  }[];
}

export async function createDepot(
  { groupId, userId }: DepotsContext,
  input: CreateDepotInput,
): Promise<Depot> {
  await ensureDepotsSchema();
  const db = getDb();
  const id = await nextId('DEP');
  const now = currentTimestamp();

  await db.prepare(
    `INSERT INTO depots_justificatifs
       (id, group_id, submitted_by_user_id, titre, description, category_id,
        unite_id, amount_cents, date_estimee, carte_id, activite_id, statut,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'a_traiter', ?, ?)`,
  ).run(
    id,
    groupId,
    userId,
    input.titre.trim(),
    input.description?.trim() || null,
    input.category_id || null,
    input.unite_id || null,
    input.amount_cents ?? null,
    input.date_estimee || null,
    input.carte_id || null,
    input.activite_id ?? null,
    now,
    now,
  );

  if (!input.files || input.files.length === 0) {
    throw new Error('Au moins un fichier justificatif est requis.');
  }

  // Les fichiers vivent dans `justificatifs` avec entity_type='depot'.
  // Un dépôt peut en regrouper plusieurs.
  for (const f of input.files) {
    await attachJustificatif(
      { groupId },
      {
        entity_type: 'depot',
        entity_id: id,
        filename: f.filename,
        content: f.content,
        mime_type: f.mime_type,
      },
    );
  }

  return (await db.prepare('SELECT * FROM depots_justificatifs WHERE id = ?').get<Depot>(id))!;
}

export interface ListDepotsOptions {
  statut?: DepotStatut;
  // Si défini, ne retourne que les dépôts soumis par ce user (vue
  // "soumetteur" : un equipier ne voit que ses propres dépôts).
  submitted_by_user_id?: string;
}

export async function listDepots(
  { groupId }: { groupId: string },
  options: ListDepotsOptions = {},
): Promise<DepotEnriched[]> {
  await ensureDepotsSchema();
  const conditions: string[] = ['d.group_id = ?'];
  const values: unknown[] = [groupId];
  if (options.statut) { conditions.push('d.statut = ?'); values.push(options.statut); }
  if (options.submitted_by_user_id) {
    conditions.push('d.submitted_by_user_id = ?');
    values.push(options.submitted_by_user_id);
  }

  return await getDb()
    .prepare(
      `SELECT d.*,
              u.nom_affichage AS submitter_name,
              u.email AS submitter_email,
              un.code AS unite_code,
              c.name AS category_name,
              ca.porteur AS carte_label,
              (SELECT file_path FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id ORDER BY uploaded_at DESC LIMIT 1) AS justif_path,
              (SELECT group_concat(file_path, char(10)) FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id) AS justif_paths,
              (SELECT COUNT(*) FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id) AS justif_count
       FROM depots_justificatifs d
       JOIN users u ON u.id = d.submitted_by_user_id
       LEFT JOIN unites un ON un.id = d.unite_id
       LEFT JOIN categories c ON c.id = d.category_id
       LEFT JOIN cartes ca ON ca.id = d.carte_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.created_at DESC`,
    )
    .all<DepotEnriched>(...values);
}

export interface DepotForSharing {
  id: string;
  titre: string;
  amount_cents: number | null;
  date_estimee: string | null;
  ecriture_id: string | null;
  ecriture_description: string | null; // écriture principale (A)
  justif_paths: string | null; // chemins des fichiers, séparés par char(10)
  justif_count: number;
}

// Dépôts DÉJÀ rattachés (statut='rattache') qui portent au moins un fichier,
// pour le sélecteur « rattacher un justif déjà déposé à cette écriture »
// (paiement scindé). Les fichiers sont retrouvés par le préfixe de chemin
// `depot/<id>/…` (figé), pas par l'entité justificatifs (re-pointée vers
// l'écriture A au 1er rattachement). Cf. shareDepotToEcriture.
export async function listRattacheDepotsForSharing(
  { groupId }: { groupId: string },
): Promise<DepotForSharing[]> {
  await ensureDepotsSchema();
  return await getDb()
    .prepare(
      `SELECT d.id AS id, d.titre AS titre, d.amount_cents AS amount_cents,
              d.date_estimee AS date_estimee, d.ecriture_id AS ecriture_id,
              ea.description AS ecriture_description,
              (SELECT group_concat(file_path, char(10)) FROM justificatifs
                 WHERE group_id = d.group_id AND file_path LIKE 'depot/' || d.id || '/%') AS justif_paths,
              (SELECT COUNT(*) FROM justificatifs
                 WHERE group_id = d.group_id AND file_path LIKE 'depot/' || d.id || '/%') AS justif_count
       FROM depots_justificatifs d
       LEFT JOIN ecritures ea ON ea.id = d.ecriture_id
       WHERE d.group_id = ? AND d.statut = 'rattache'
         AND EXISTS(SELECT 1 FROM justificatifs
                      WHERE group_id = d.group_id AND file_path LIKE 'depot/' || d.id || '/%')
       ORDER BY d.created_at DESC`,
    )
    .all<DepotForSharing>(groupId);
}

export async function getDepot(
  { groupId }: { groupId: string },
  id: string,
): Promise<DepotEnriched | null> {
  await ensureDepotsSchema();
  const row = await getDb()
    .prepare(
      `SELECT d.*,
              u.nom_affichage AS submitter_name,
              u.email AS submitter_email,
              un.code AS unite_code,
              c.name AS category_name,
              ca.porteur AS carte_label,
              (SELECT file_path FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id ORDER BY uploaded_at DESC LIMIT 1) AS justif_path,
              (SELECT group_concat(file_path, char(10)) FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id) AS justif_paths,
              (SELECT COUNT(*) FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id) AS justif_count
       FROM depots_justificatifs d
       JOIN users u ON u.id = d.submitted_by_user_id
       LEFT JOIN unites un ON un.id = d.unite_id
       LEFT JOIN categories c ON c.id = d.category_id
       LEFT JOIN cartes ca ON ca.id = d.carte_id
       WHERE d.id = ? AND d.group_id = ?`,
    )
    .get<DepotEnriched>(id, groupId);
  return row ?? null;
}

export async function rejectDepot(
  { groupId }: { groupId: string },
  id: string,
  motif: string,
): Promise<Depot> {
  await ensureDepotsSchema();
  if (!motif?.trim()) throw new Error('Motif de rejet obligatoire.');
  const db = getDb();
  const existing = await db
    .prepare('SELECT statut FROM depots_justificatifs WHERE id = ? AND group_id = ?')
    .get<{ statut: string }>(id, groupId);
  if (!existing) throw new Error(`Dépôt ${id} introuvable.`);
  if (existing.statut !== 'a_traiter') {
    throw new Error(`Dépôt déjà ${existing.statut}, impossible de rejeter.`);
  }
  await db.prepare(
    `UPDATE depots_justificatifs
     SET statut = 'rejete', motif_rejet = ?, updated_at = ?
     WHERE id = ? AND group_id = ?`,
  ).run(motif.trim(), currentTimestamp(), id, groupId);
  return (await db.prepare('SELECT * FROM depots_justificatifs WHERE id = ?').get<Depot>(id))!;
}

export async function attachDepotToEcriture(
  { groupId }: { groupId: string },
  depotId: string,
  ecritureId: string,
): Promise<Depot> {
  await ensureDepotsSchema();
  const db = getDb();

  const depot = await db
    .prepare(
      `SELECT statut, titre, category_id, unite_id, carte_id, activite_id
       FROM depots_justificatifs WHERE id = ? AND group_id = ?`,
    )
    .get<{
      statut: string;
      titre: string;
      category_id: string | null;
      unite_id: string | null;
      carte_id: string | null;
      activite_id: string | null;
    }>(depotId, groupId);
  if (!depot) throw new Error(`Dépôt ${depotId} introuvable.`);
  if (depot.statut !== 'a_traiter') {
    throw new Error(`Dépôt déjà ${depot.statut}, impossible de rattacher.`);
  }

  const ecriture = await db
    .prepare('SELECT id, status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ id: string; status: string }>(ecritureId, groupId);
  if (!ecriture) throw new Error(`Écriture ${ecritureId} introuvable dans ce groupe.`);

  // Migre le file vers l'écriture (pour qu'il soit visible par les
  // services existants qui cherchent justifs d'une écriture).
  await db.prepare(
    `UPDATE justificatifs
     SET entity_type = 'ecriture', entity_id = ?
     WHERE entity_type = 'depot' AND entity_id = ?`,
  ).run(ecritureId, depotId);

  await db.prepare(
    `UPDATE depots_justificatifs
     SET statut = 'rattache', ecriture_id = ?, updated_at = ?
     WHERE id = ? AND group_id = ?`,
  ).run(ecritureId, currentTimestamp(), depotId, groupId);

  // Enrichissement : si l'écriture est encore en draft (préparation
  // locale), on copie les infos du dépôt dans les champs encore vides
  // (COALESCE → on n'écrase jamais une valeur déjà saisie). Évite au
  // trésorier de re-saisir catégorie / unité / carte que le déposeur a
  // déjà renseignées. numero_piece reste vide : il vient de Comptaweb,
  // pas du dépôt.
  if (ecriture.status === 'draft') {
    await db.prepare(
      `UPDATE ecritures SET
         category_id = COALESCE(category_id, ?),
         unite_id    = COALESCE(unite_id, ?),
         carte_id    = COALESCE(carte_id, ?),
         activite_id = COALESCE(activite_id, ?),
         updated_at  = ?
       WHERE id = ? AND group_id = ? AND status = 'draft'`,
    ).run(
      depot.category_id,
      depot.unite_id,
      depot.carte_id,
      depot.activite_id,
      currentTimestamp(),
      ecritureId,
      groupId,
    );
  }

  // Titre parlant : si l'écriture porte encore le libellé bancaire brut
  // (nudge « à renommer » = même condition que le flag `titre_a_renommer`),
  // elle hérite du `titre` du dépôt — un titre saisi vaut mieux qu'un
  // « AUCHANSUPERMAR… ». `libelle_origine` (clé de rapprochement) reste intact ;
  // un titre déjà renommé n'est pas touché ; une écriture déjà dans CW non plus
  // (status ≠ draft). Demande terrain 2026-07-02.
  await db.prepare(
    `UPDATE ecritures SET description = ?, updated_at = ?
      WHERE id = ? AND group_id = ? AND status = 'draft'
        AND libelle_origine IS NOT NULL AND description = libelle_origine`,
  ).run(depot.titre, currentTimestamp(), ecritureId, groupId);

  return (await db.prepare('SELECT * FROM depots_justificatifs WHERE id = ?').get<Depot>(depotId))!;
}

// Partage le justificatif d'un dépôt DÉJÀ rattaché vers une 2ᵉ écriture
// (paiement scindé en 2 : 1 justif = 2 écritures). Additif et non destructif :
// le dépôt et son écriture principale (A) ne bougent pas, on ne fait qu'AJOUTER
// des lignes `justificatifs` sur l'écriture cible (B) pointant le MÊME blob.
//
// Clé : le blob n'est jamais déplacé — son `file_path` reste « depot/<id>/… »
// même après que le 1er rattachement a re-pointé la ligne vers l'écriture A.
// On retrouve donc les fichiers du dépôt par `file_path`, puis on crée une
// nouvelle ligne vers le même blob (aucun ré-upload, aucune duplication de
// stockage). Demande terrain 2026-07-04.
export async function shareDepotToEcriture(
  { groupId }: { groupId: string },
  depotId: string,
  ecritureId: string,
): Promise<{ copied: number }> {
  await ensureDepotsSchema();
  const db = getDb();

  const depot = await db
    .prepare(
      `SELECT titre, category_id, unite_id, carte_id, activite_id
       FROM depots_justificatifs WHERE id = ? AND group_id = ?`,
    )
    .get<{
      titre: string;
      category_id: string | null;
      unite_id: string | null;
      carte_id: string | null;
      activite_id: string | null;
    }>(depotId, groupId);
  if (!depot) throw new Error(`Dépôt ${depotId} introuvable.`);

  const ecriture = await db
    .prepare('SELECT id, status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ id: string; status: string }>(ecritureId, groupId);
  if (!ecriture) throw new Error(`Écriture ${ecritureId} introuvable dans ce groupe.`);

  // Fichiers du dépôt, identifiés par le préfixe de chemin du blob (figé à la
  // création), indépendamment de l'entité vers laquelle la ligne pointe
  // aujourd'hui (le 1er rattachement a re-pointé vers l'écriture A).
  const pathPrefix = `depot/${depotId}/%`;
  const sources = await db
    .prepare(
      `SELECT file_path, original_filename, mime_type
       FROM justificatifs WHERE group_id = ? AND file_path LIKE ?`,
    )
    .all<{ file_path: string; original_filename: string; mime_type: string | null }>(groupId, pathPrefix);
  if (sources.length === 0) {
    throw new Error(`Le dépôt ${depotId} n'a aucun justificatif à partager.`);
  }

  // Copie chaque fichier absent de l'écriture cible (idempotence : pas deux
  // fois la même pièce si on reclique).
  let copied = 0;
  for (const f of sources) {
    const already = await db
      .prepare(
        `SELECT 1 FROM justificatifs
         WHERE group_id = ? AND entity_type = 'ecriture' AND entity_id = ? AND file_path = ?`,
      )
      .get<{ 1: number }>(groupId, ecritureId, f.file_path);
    if (already) continue;
    const id = await nextId('JUS');
    await db
      .prepare(
        `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
         VALUES (?, ?, ?, ?, ?, 'ecriture', ?, ?)`,
      )
      .run(id, groupId, f.file_path, f.original_filename, f.mime_type, ecritureId, currentTimestamp());
    copied++;
  }

  // Héritage imputation + titre sur l'écriture cible, uniquement si draft, à
  // l'identique de `attachDepotToEcriture` (COALESCE → jamais d'écrasement ;
  // titre seulement si l'écriture porte encore le libellé bancaire brut).
  if (ecriture.status === 'draft') {
    await db
      .prepare(
        `UPDATE ecritures SET
           category_id = COALESCE(category_id, ?),
           unite_id    = COALESCE(unite_id, ?),
           carte_id    = COALESCE(carte_id, ?),
           activite_id = COALESCE(activite_id, ?),
           updated_at  = ?
         WHERE id = ? AND group_id = ? AND status = 'draft'`,
      )
      .run(depot.category_id, depot.unite_id, depot.carte_id, depot.activite_id, currentTimestamp(), ecritureId, groupId);
    await db
      .prepare(
        `UPDATE ecritures SET description = ?, updated_at = ?
          WHERE id = ? AND group_id = ? AND status = 'draft'
            AND libelle_origine IS NOT NULL AND description = libelle_origine`,
      )
      .run(depot.titre, currentTimestamp(), ecritureId, groupId);
  }

  return { copied };
}

// Liste les écritures candidates pour un rattachement. Une écriture qui a
// déjà un justif reste candidate (on peut vouloir y attacher la facture
// complète en plus d'un ticket par exemple) — l'UI affiche un compteur
// pour informer.
export interface CandidateEcriture {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  unite_code: string | null;
  existing_justifs_count: number;
}

export async function listCandidateEcritures(
  { groupId }: { groupId: string },
  opts: { amount_cents?: number | null; date_estimee?: string | null } = {},
): Promise<CandidateEcriture[]> {
  await ensureDepotsSchema();
  const conditions: string[] = ['e.group_id = ?'];
  const values: unknown[] = [groupId];

  // Tolérance de matching : ±10% sur le montant, ±15j sur la date si fournis.
  if (opts.amount_cents) {
    const tol = Math.max(100, Math.round(Math.abs(opts.amount_cents) * 0.1));
    conditions.push('ABS(e.amount_cents - ?) <= ?');
    values.push(Math.abs(opts.amount_cents), tol);
  }
  if (opts.date_estimee) {
    conditions.push("ABS(julianday(e.date_ecriture) - julianday(?)) <= 15");
    values.push(opts.date_estimee);
  }

  return await getDb()
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type,
              un.code AS unite_code,
              (SELECT COUNT(*) FROM justificatifs j
                WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) AS existing_justifs_count
       FROM ecritures e
       LEFT JOIN unites un ON un.id = e.unite_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ABS(julianday(e.date_ecriture) - julianday(COALESCE(?, e.date_ecriture))) ASC,
                e.date_ecriture DESC
       LIMIT 30`,
    )
    .all<CandidateEcriture>(...values, opts.date_estimee ?? null);
}

// Recherche élargie : toutes les écritures du groupe, sans filtre de
// montant/date, pour le cas où l'heuristique stricte ne propose rien
// d'utilisable. Limité à 200 lignes triées par date desc.
export async function listAllAttachableEcritures(
  { groupId }: { groupId: string },
  opts: { excludeIds?: string[] } = {},
): Promise<CandidateEcriture[]> {
  await ensureDepotsSchema();
  const conditions: string[] = ['e.group_id = ?'];
  const values: unknown[] = [groupId];
  if (opts.excludeIds && opts.excludeIds.length > 0) {
    conditions.push(`e.id NOT IN (${opts.excludeIds.map(() => '?').join(',')})`);
    values.push(...opts.excludeIds);
  }
  return await getDb()
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type,
              un.code AS unite_code,
              (SELECT COUNT(*) FROM justificatifs j
                WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) AS existing_justifs_count
       FROM ecritures e
       LEFT JOIN unites un ON un.id = e.unite_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.date_ecriture DESC
       LIMIT 200`,
    )
    .all<CandidateEcriture>(...values);
}

// === Liaison dépôt → demande de remboursement ===
//
// Symétrique du flux dépôt → écriture mais pour les demandes de
// remboursement encore actives (pas terminées ni refusées). Permet à un
// utilisateur de déposer un justif AVANT d'avoir fait sa demande, puis
// au trésorier de rapprocher quand la demande arrive.

export interface CandidateRemboursement {
  id: string;
  date_depense: string | null;
  // Date du virement (paiement du remboursement). Pour matcher l'écriture
  // de virement, c'est CETTE date qui compte (pas date_depense, souvent
  // des semaines avant).
  date_paiement: string | null;
  demandeur: string;
  total_cents: number;
  status: string;
  unite_code: string | null;
  existing_justifs_count: number;
}

const REMB_ATTACHABLE_STATUSES = "'a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue'";

export async function listCandidateRemboursements(
  { groupId }: { groupId: string },
  opts: { amount_cents?: number | null; date_estimee?: string | null } = {},
): Promise<CandidateRemboursement[]> {
  const conditions: string[] = [
    'r.group_id = ?',
    `r.status IN (${REMB_ATTACHABLE_STATUSES})`,
  ];
  const values: unknown[] = [groupId];
  if (opts.amount_cents) {
    const tol = Math.max(100, Math.round(Math.abs(opts.amount_cents) * 0.1));
    conditions.push('ABS(r.total_cents - ?) <= ?');
    values.push(Math.abs(opts.amount_cents), tol);
  }
  if (opts.date_estimee) {
    conditions.push("r.date_depense IS NOT NULL AND ABS(julianday(r.date_depense) - julianday(?)) <= 15");
    values.push(opts.date_estimee);
  }
  return await getDb()
    .prepare(
      `SELECT r.id, r.date_depense, r.date_paiement, r.demandeur, r.total_cents, r.status,
              un.code AS unite_code,
              (SELECT COUNT(*) FROM justificatifs j
                WHERE j.entity_type = 'remboursement' AND j.entity_id = r.id) AS existing_justifs_count
       FROM remboursements r
       LEFT JOIN unites un ON un.id = r.unite_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ABS(julianday(COALESCE(r.date_depense, '1970-01-01')) - julianday(COALESCE(?, COALESCE(r.date_depense, '1970-01-01')))) ASC,
                COALESCE(r.date_depense, r.created_at) DESC
       LIMIT 30`,
    )
    .all<CandidateRemboursement>(...values, opts.date_estimee ?? null);
}

export async function listAllAttachableRemboursements(
  { groupId }: { groupId: string },
  // `unlinkedOnly` : exclut les remboursements déjà liés à une écriture
  // (ecriture_id renseigné). Utilisé par la bannière de correspondance
  // écriture→remb (un remb déjà rattaché ne doit plus être proposé). La page
  // Dépôts garde le comportement par défaut (un remb avec virement peut
  // encore recevoir un justif).
  opts: { unlinkedOnly?: boolean } = {},
): Promise<CandidateRemboursement[]> {
  const linkedClause = opts.unlinkedOnly ? 'AND r.ecriture_id IS NULL' : '';
  return await getDb()
    .prepare(
      `SELECT r.id, r.date_depense, r.date_paiement, r.demandeur, r.total_cents, r.status,
              un.code AS unite_code,
              (SELECT COUNT(*) FROM justificatifs j
                WHERE j.entity_type = 'remboursement' AND j.entity_id = r.id) AS existing_justifs_count
       FROM remboursements r
       LEFT JOIN unites un ON un.id = r.unite_id
       WHERE r.group_id = ? AND r.status IN (${REMB_ATTACHABLE_STATUSES}) ${linkedClause}
       ORDER BY COALESCE(r.date_depense, r.created_at) DESC
       LIMIT 100`,
    )
    .all<CandidateRemboursement>(groupId);
}

export async function attachDepotToRemboursement(
  { groupId }: { groupId: string },
  depotId: string,
  remboursementId: string,
): Promise<Depot> {
  await ensureDepotsSchema();
  const db = getDb();

  const depot = await db
    .prepare('SELECT statut FROM depots_justificatifs WHERE id = ? AND group_id = ?')
    .get<{ statut: string }>(depotId, groupId);
  if (!depot) throw new Error(`Dépôt ${depotId} introuvable.`);
  if (depot.statut !== 'a_traiter') {
    throw new Error(`Dépôt déjà ${depot.statut}, impossible de rattacher.`);
  }

  const remb = await db
    .prepare('SELECT id, status FROM remboursements WHERE id = ? AND group_id = ?')
    .get<{ id: string; status: string }>(remboursementId, groupId);
  if (!remb) throw new Error(`Demande de remboursement ${remboursementId} introuvable dans ce groupe.`);
  if (remb.status === 'termine' || remb.status === 'refuse') {
    throw new Error(`Demande ${remboursementId} clôturée (${remb.status}), impossible de rattacher.`);
  }

  await db.prepare(
    `UPDATE justificatifs
     SET entity_type = 'remboursement', entity_id = ?
     WHERE entity_type = 'depot' AND entity_id = ?`,
  ).run(remboursementId, depotId);

  await db.prepare(
    `UPDATE depots_justificatifs
     SET statut = 'rattache', remboursement_id = ?, updated_at = ?
     WHERE id = ? AND group_id = ?`,
  ).run(remboursementId, currentTimestamp(), depotId, groupId);

  return (await db.prepare('SELECT * FROM depots_justificatifs WHERE id = ?').get<Depot>(depotId))!;
}
