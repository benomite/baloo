import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';
import { REMBOURSEMENT_STATUSES, type Remboursement, type RemboursementStatus } from '../types';

// Re-exports legacy : `RBT_STATUTS` / `RbtStatut` étaient les noms
// historiques avant la centralisation dans `types.ts`. Conservés pour
// ne pas casser les imports existants.
export const RBT_STATUTS = REMBOURSEMENT_STATUSES;
export type RbtStatut = RemboursementStatus;

export interface RemboursementLigne {
  id: string;
  remboursement_id: string;
  date_depense: string;
  amount_cents: number;
  nature: string;
  notes: string | null;
  created_at: string;
}

export interface RemboursementContext {
  groupId: string;
  // Chantier 5 : si défini, restreint aux remboursements de cette unité.
  scopeUniteId?: string | null;
  // Chantier 2 P2-workflows : si défini, restreint aux remboursements
  // soumis par ce user (vue "mes demandes" pour equipier / chef).
  submittedByUserId?: string | null;
}

export interface RemboursementFilters {
  status?: string;
  unite_id?: string;
  demandeur?: string;
  search?: string;
  limit?: number;
  /** `true` : filtre les rembs qui ont eu un virement (`virement_effectue`
   *  ou `termine`) mais ne sont pas liées à une écriture comptable. */
  unlinkedOnly?: boolean;
}

export async function listRemboursements(
  { groupId, scopeUniteId, submittedByUserId }: RemboursementContext,
  filters: RemboursementFilters = {},
): Promise<Remboursement[]> {
  const conditions: string[] = ['r.group_id = ?'];
  const values: unknown[] = [groupId];

  if (filters.status) { conditions.push('r.status = ?'); values.push(filters.status); }
  if (submittedByUserId) {
    conditions.push('r.submitted_by_user_id = ?');
    values.push(submittedByUserId);
  }
  if (scopeUniteId) { conditions.push('r.unite_id = ?'); values.push(scopeUniteId); }
  else if (filters.unite_id) { conditions.push('r.unite_id = ?'); values.push(filters.unite_id); }
  if (filters.demandeur) { conditions.push('r.demandeur LIKE ?'); values.push(`%${filters.demandeur}%`); }
  if (filters.search) {
    conditions.push('(r.demandeur LIKE ? OR r.nature LIKE ? OR r.notes LIKE ?)');
    values.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.unlinkedOnly) {
    conditions.push("r.ecriture_id IS NULL");
    conditions.push("r.status IN ('virement_effectue', 'termine')");
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  return await getDb()
    .prepare(
      `SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
       FROM remboursements r
       LEFT JOIN unites u ON u.id = r.unite_id
       LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
       ${where}
       ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all<Remboursement>(...values, filters.limit ?? 50);
}

export async function getRemboursement(
  { groupId, scopeUniteId, submittedByUserId }: RemboursementContext,
  id: string,
): Promise<Remboursement | undefined> {
  const conditions = ['r.id = ?', 'r.group_id = ?'];
  const values: unknown[] = [id, groupId];
  if (submittedByUserId) { conditions.push('r.submitted_by_user_id = ?'); values.push(submittedByUserId); }
  if (scopeUniteId) { conditions.push('r.unite_id = ?'); values.push(scopeUniteId); }
  return await getDb()
    .prepare(
      `SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
       FROM remboursements r
       LEFT JOIN unites u ON u.id = r.unite_id
       LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
       WHERE ${conditions.join(' AND ')}`,
    )
    .get<Remboursement>(...values);
}

export interface CreateRemboursementInput {
  demandeur: string;
  amount_cents: number;
  date_depense: string;
  nature: string;
  unite_id?: string | null;
  justificatif_status?: 'oui' | 'en_attente' | 'non';
  mode_paiement_id?: string | null;
  notes?: string | null;
  submitted_by_user_id?: string | null;
  // Champs valdesous-style (chantier 2-bis).
  prenom?: string | null;
  nom?: string | null;
  email?: string | null;
  rib_texte?: string | null;
  rib_file_path?: string | null;
}

export async function createRemboursement(
  { groupId }: RemboursementContext,
  input: CreateRemboursementInput,
): Promise<Remboursement> {
  const db = getDb();
  const id = await nextId('RBT');
  const now = currentTimestamp();

  await db.prepare(
    `INSERT INTO remboursements (
       id, group_id, demandeur, prenom, nom, email, rib_texte, rib_file_path,
       amount_cents, total_cents, date_depense, nature, unite_id,
       justificatif_status, mode_paiement_id, notes, submitted_by_user_id,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.demandeur,
    nullIfEmpty(input.prenom),
    nullIfEmpty(input.nom),
    nullIfEmpty(input.email),
    nullIfEmpty(input.rib_texte),
    nullIfEmpty(input.rib_file_path),
    input.amount_cents,
    input.amount_cents,
    input.date_depense,
    input.nature,
    nullIfEmpty(input.unite_id),
    input.justificatif_status ?? 'en_attente',
    nullIfEmpty(input.mode_paiement_id),
    nullIfEmpty(input.notes),
    nullIfEmpty(input.submitted_by_user_id),
    now,
    now,
  );

  return (await db.prepare('SELECT * FROM remboursements WHERE id = ?').get<Remboursement>(id))!;
}

// =============================================================================
// Multi-lignes (chantier 2-bis)
// =============================================================================

export interface CreateLigneInput {
  date_depense: string;
  amount_cents: number;
  nature: string;
  notes?: string | null;
}

export async function addLigne(
  remboursementId: string,
  input: CreateLigneInput,
): Promise<RemboursementLigne> {
  const db = getDb();
  const id = randomUUID();
  const now = currentTimestamp();
  await db.prepare(
    `INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, remboursementId, input.date_depense, input.amount_cents, input.nature, nullIfEmpty(input.notes), now);
  await recalcTotal(remboursementId);
  return (await db.prepare('SELECT * FROM remboursement_lignes WHERE id = ?').get<RemboursementLigne>(id))!;
}

export async function listLignes(remboursementId: string): Promise<RemboursementLigne[]> {
  return await getDb()
    .prepare('SELECT * FROM remboursement_lignes WHERE remboursement_id = ? ORDER BY date_depense ASC, created_at ASC')
    .all<RemboursementLigne>(remboursementId);
}

export async function deleteLigne(ligneId: string): Promise<void> {
  const db = getDb();
  const ligne = await db
    .prepare('SELECT remboursement_id FROM remboursement_lignes WHERE id = ?')
    .get<{ remboursement_id: string }>(ligneId);
  if (!ligne) return;
  await db.prepare('DELETE FROM remboursement_lignes WHERE id = ?').run(ligneId);
  await recalcTotal(ligne.remboursement_id);
}

// Calcule un hash SHA-256 canonique des données métier d'une demande
// (signature électronique : si une ligne ou un champ est modifié après
// signature, le hash recalculé ne matchera plus celui stocké).
//
// IMPORTANT : on inclut UNIQUEMENT les données saisies par le demandeur
// (identité, RIB, lignes), PAS les champs de workflow (status, validations,
// etc.) qui évoluent par construction au fil des signatures.
export function computeRemboursementHash(
  rbt: Remboursement,
  lignes: RemboursementLigne[],
): string {
  const sortedLignes = [...lignes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((l) => ({
      date_depense: l.date_depense,
      amount_cents: l.amount_cents,
      nature: l.nature,
      notes: l.notes ?? null,
    }));
  const canonical = JSON.stringify({
    id: rbt.id,
    prenom: rbt.prenom,
    nom: rbt.nom,
    email: rbt.email,
    rib_texte: rbt.rib_texte,
    rib_file_path: rbt.rib_file_path,
    lignes: sortedLignes,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Recalcule total_cents et amount_cents (legacy mirror) depuis les lignes.
export async function recalcTotal(remboursementId: string): Promise<number> {
  const db = getDb();
  const row = await db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM remboursement_lignes WHERE remboursement_id = ?')
    .get<{ total: number }>(remboursementId);
  const total = row?.total ?? 0;
  await db.prepare(
    'UPDATE remboursements SET total_cents = ?, amount_cents = ?, updated_at = ? WHERE id = ?',
  ).run(total, total, currentTimestamp(), remboursementId);
  return total;
}

export interface UpdateRemboursementInput {
  status?: RbtStatut;
  date_paiement?: string | null;
  mode_paiement_id?: string | null;
  justificatif_status?: 'oui' | 'en_attente' | 'non';
  comptaweb_synced?: boolean;
  ecriture_id?: string | null;
  notes?: string | null;
  motif_refus?: string | null;
}

export async function updateRemboursement(
  { groupId }: RemboursementContext,
  id: string,
  patch: UpdateRemboursementInput,
): Promise<Remboursement | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
  if (patch.date_paiement !== undefined) { sets.push('date_paiement = ?'); values.push(patch.date_paiement); }
  if (patch.mode_paiement_id !== undefined) { sets.push('mode_paiement_id = ?'); values.push(nullIfEmpty(patch.mode_paiement_id)); }
  if (patch.justificatif_status !== undefined) { sets.push('justificatif_status = ?'); values.push(patch.justificatif_status); }
  if (patch.comptaweb_synced !== undefined) { sets.push('comptaweb_synced = ?'); values.push(patch.comptaweb_synced ? 1 : 0); }
  if (patch.ecriture_id !== undefined) { sets.push('ecriture_id = ?'); values.push(nullIfEmpty(patch.ecriture_id)); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(nullIfEmpty(patch.notes)); }
  if (patch.motif_refus !== undefined) { sets.push('motif_refus = ?'); values.push(nullIfEmpty(patch.motif_refus)); }

  if (sets.length === 0) {
    return (await getRemboursement({ groupId }, id)) ?? null;
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = await getDb()
    .prepare(`UPDATE remboursements SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);

  if (result.changes === 0) return null;

  return (await getRemboursement({ groupId }, id)) ?? null;
}
