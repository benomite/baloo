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
  justif_path: string | null;
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
  // Fichier joint (obligatoire à la création).
  file: {
    filename: string;
    content: Buffer;
    mime_type?: string | null;
  };
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
        unite_id, amount_cents, date_estimee, carte_id, statut,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'a_traiter', ?, ?)`,
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
    now,
    now,
  );

  // Le file vit dans `justificatifs` avec entity_type='depot'.
  await attachJustificatif(
    { groupId },
    {
      entity_type: 'depot',
      entity_id: id,
      filename: input.file.filename,
      content: input.file.content,
      mime_type: input.file.mime_type,
    },
  );

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
              (SELECT file_path FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id ORDER BY uploaded_at DESC LIMIT 1) AS justif_path
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
              (SELECT file_path FROM justificatifs WHERE entity_type = 'depot' AND entity_id = d.id ORDER BY uploaded_at DESC LIMIT 1) AS justif_path
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
    .prepare('SELECT statut FROM depots_justificatifs WHERE id = ? AND group_id = ?')
    .get<{ statut: string }>(depotId, groupId);
  if (!depot) throw new Error(`Dépôt ${depotId} introuvable.`);
  if (depot.statut !== 'a_traiter') {
    throw new Error(`Dépôt déjà ${depot.statut}, impossible de rattacher.`);
  }

  const ecriture = await db
    .prepare('SELECT id FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(ecritureId, groupId);
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

  return (await db.prepare('SELECT * FROM depots_justificatifs WHERE id = ?').get<Depot>(depotId))!;
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
