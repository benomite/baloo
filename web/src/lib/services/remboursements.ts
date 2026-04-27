import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { Remboursement } from '../types';

export interface RemboursementContext {
  groupId: string;
}

export interface RemboursementFilters {
  status?: string;
  unite_id?: string;
  demandeur?: string;
  search?: string;
  limit?: number;
}

export function listRemboursements(
  { groupId }: RemboursementContext,
  filters: RemboursementFilters = {},
): Remboursement[] {
  const conditions: string[] = ['r.group_id = ?'];
  const values: unknown[] = [groupId];

  if (filters.status) { conditions.push('r.status = ?'); values.push(filters.status); }
  if (filters.unite_id) { conditions.push('r.unite_id = ?'); values.push(filters.unite_id); }
  if (filters.demandeur) { conditions.push('r.demandeur LIKE ?'); values.push(`%${filters.demandeur}%`); }
  if (filters.search) {
    conditions.push('(r.demandeur LIKE ? OR r.nature LIKE ? OR r.notes LIKE ?)');
    values.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  return getDb()
    .prepare(
      `SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
       FROM remboursements r
       LEFT JOIN unites u ON u.id = r.unite_id
       LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
       ${where}
       ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(...values, filters.limit ?? 50) as Remboursement[];
}

export function getRemboursement(
  { groupId }: RemboursementContext,
  id: string,
): Remboursement | undefined {
  return getDb()
    .prepare(
      `SELECT r.*, u.code as unite_code, m.name as mode_paiement_name
       FROM remboursements r
       LEFT JOIN unites u ON u.id = r.unite_id
       LEFT JOIN modes_paiement m ON m.id = r.mode_paiement_id
       WHERE r.id = ? AND r.group_id = ?`,
    )
    .get(id, groupId) as Remboursement | undefined;
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
}

export function createRemboursement(
  { groupId }: RemboursementContext,
  input: CreateRemboursementInput,
): Remboursement {
  const db = getDb();
  const id = nextId('RBT');
  const now = currentTimestamp();

  db.prepare(
    `INSERT INTO remboursements (id, group_id, demandeur, amount_cents, date_depense, nature, unite_id, justificatif_status, mode_paiement_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.demandeur,
    input.amount_cents,
    input.date_depense,
    input.nature,
    input.unite_id ?? null,
    input.justificatif_status ?? 'en_attente',
    input.mode_paiement_id ?? null,
    input.notes ?? null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM remboursements WHERE id = ?').get(id) as Remboursement;
}

export interface UpdateRemboursementInput {
  status?: 'demande' | 'valide' | 'paye' | 'refuse';
  date_paiement?: string | null;
  mode_paiement_id?: string | null;
  justificatif_status?: 'oui' | 'en_attente' | 'non';
  comptaweb_synced?: boolean;
  ecriture_id?: string | null;
  notes?: string | null;
}

export function updateRemboursement(
  { groupId }: RemboursementContext,
  id: string,
  patch: UpdateRemboursementInput,
): Remboursement | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
  if (patch.date_paiement !== undefined) { sets.push('date_paiement = ?'); values.push(patch.date_paiement); }
  if (patch.mode_paiement_id !== undefined) { sets.push('mode_paiement_id = ?'); values.push(patch.mode_paiement_id); }
  if (patch.justificatif_status !== undefined) { sets.push('justificatif_status = ?'); values.push(patch.justificatif_status); }
  if (patch.comptaweb_synced !== undefined) { sets.push('comptaweb_synced = ?'); values.push(patch.comptaweb_synced ? 1 : 0); }
  if (patch.ecriture_id !== undefined) { sets.push('ecriture_id = ?'); values.push(patch.ecriture_id); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }

  if (sets.length === 0) {
    return getRemboursement({ groupId }, id) ?? null;
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE remboursements SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);

  if (result.changes === 0) return null;

  return getRemboursement({ groupId }, id) ?? null;
}
