import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { Ecriture } from '../types';

export interface EcritureContext {
  groupId: string;
}

export interface EcritureFilters {
  unite_id?: string;
  category_id?: string;
  type?: string;
  date_debut?: string;
  date_fin?: string;
  mode_paiement_id?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
  // Préset : uniquement les drafts avec au moins un champ obligatoire manquant.
  incomplete?: boolean;
  // Préset : uniquement les écritures issues d'une ligne bancaire Comptaweb.
  from_bank?: boolean;
}

// Renvoie la liste des champs manquants qui bloquent la synchronisation.
// Les drafts issus d'une ligne bancaire sont considérés "à compléter" s'il
// leur manque nature/activité/unité/mode ; une dépense est signalée "justif"
// manquante dès que justif_attendu=1 et aucun fichier rattaché — même si
// numero_piece est renseigné (le code Comptaweb permet la sync mais ne
// remplace pas le document physique).
export function computeMissingFields(e: {
  status: string;
  category_id: string | null;
  activite_id: string | null;
  unite_id: string | null;
  mode_paiement_id: string | null;
  type: string;
  numero_piece: string | null;
  justif_attendu: number;
  has_justificatif?: boolean;
}): string[] {
  if (e.status !== 'brouillon') return [];
  const missing: string[] = [];
  if (!e.category_id) missing.push('nature');
  if (!e.activite_id) missing.push('activité');
  if (!e.unite_id) missing.push('unité');
  if (!e.mode_paiement_id) missing.push('mode');
  if (e.type === 'depense' && e.justif_attendu === 1 && !e.has_justificatif) {
    missing.push('justif');
  }
  return missing;
}

export function listEcritures(
  { groupId }: EcritureContext,
  filters: EcritureFilters = {},
): { ecritures: Ecriture[]; total: number } {
  const conditions: string[] = ['e.group_id = ?'];
  const values: unknown[] = [groupId];

  if (filters.unite_id) { conditions.push('e.unite_id = ?'); values.push(filters.unite_id); }
  if (filters.category_id) { conditions.push('e.category_id = ?'); values.push(filters.category_id); }
  if (filters.type) { conditions.push('e.type = ?'); values.push(filters.type); }
  if (filters.date_debut) { conditions.push('e.date_ecriture >= ?'); values.push(filters.date_debut); }
  if (filters.date_fin) { conditions.push('e.date_ecriture <= ?'); values.push(filters.date_fin); }
  if (filters.mode_paiement_id) { conditions.push('e.mode_paiement_id = ?'); values.push(filters.mode_paiement_id); }
  if (filters.status) { conditions.push('e.status = ?'); values.push(filters.status); }
  if (filters.search) { conditions.push('(e.description LIKE ? OR e.notes LIKE ?)'); values.push(`%${filters.search}%`, `%${filters.search}%`); }
  if (filters.from_bank) { conditions.push('e.ligne_bancaire_id IS NOT NULL'); }
  if (filters.incomplete) { conditions.push("e.status = 'brouillon'"); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const rows = getDb().prepare(
    `SELECT e.*, u.code as unite_code, c.name as category_name, m.name as mode_paiement_name, a.name as activite_name,
       EXISTS(SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id) as has_justificatif
     FROM ecritures e
     LEFT JOIN unites u ON u.id = e.unite_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
     LEFT JOIN activites a ON a.id = e.activite_id
     ${where}
     ORDER BY
       CASE e.status WHEN 'brouillon' THEN 0 WHEN 'valide' THEN 1 ELSE 2 END,
       e.date_ecriture DESC, e.created_at DESC
     LIMIT ? OFFSET ?`,
  ).all(...values, limit, offset) as Ecriture[];

  const ecritures = rows.map((e) => ({ ...e, missing_fields: computeMissingFields(e) }));
  const filtered = filters.incomplete
    ? ecritures.filter((e) => (e.missing_fields ?? []).length > 0)
    : ecritures;

  const countRow = getDb()
    .prepare(`SELECT COUNT(*) as total FROM ecritures e ${where}`)
    .get(...values) as { total: number };
  const total = filters.incomplete ? filtered.length : countRow.total;

  return { ecritures: filtered, total };
}

export function getEcriture({ groupId }: EcritureContext, id: string): Ecriture | undefined {
  return getDb().prepare(
    `SELECT e.*, u.code as unite_code, c.name as category_name, m.name as mode_paiement_name, a.name as activite_name
     FROM ecritures e
     LEFT JOIN unites u ON u.id = e.unite_id
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
     LEFT JOIN activites a ON a.id = e.activite_id
     WHERE e.id = ? AND e.group_id = ?`,
  ).get(id, groupId) as Ecriture | undefined;
}

export interface CreateEcritureInput {
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  unite_id?: string | null;
  category_id?: string | null;
  mode_paiement_id?: string | null;
  activite_id?: string | null;
  numero_piece?: string | null;
  justif_attendu?: 0 | 1 | boolean;
  notes?: string | null;
}

export function createEcriture(
  { groupId }: EcritureContext,
  input: CreateEcritureInput,
): Ecriture {
  const db = getDb();
  const prefix = input.type === 'depense' ? 'DEP' : 'REC';
  const id = nextId(prefix);
  const now = currentTimestamp();
  const justifAttendu = input.justif_attendu === undefined
    ? 1
    : (input.justif_attendu ? 1 : 0);

  db.prepare(
    `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, unite_id, category_id, mode_paiement_id, activite_id, numero_piece, justif_attendu, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.date_ecriture,
    input.description,
    input.amount_cents,
    input.type,
    input.unite_id ?? null,
    input.category_id ?? null,
    input.mode_paiement_id ?? null,
    input.activite_id ?? null,
    input.numero_piece ?? null,
    justifAttendu,
    input.notes ?? null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM ecritures WHERE id = ?').get(id) as Ecriture;
}

export interface UpdateEcritureInput {
  date_ecriture?: string;
  description?: string;
  amount_cents?: number;
  type?: 'depense' | 'recette';
  unite_id?: string | null;
  category_id?: string | null;
  mode_paiement_id?: string | null;
  activite_id?: string | null;
  numero_piece?: string | null;
  justif_attendu?: 0 | 1 | boolean;
  status?: 'brouillon' | 'valide' | 'saisie_comptaweb';
  comptaweb_synced?: boolean;
  notes?: string | null;
}

export function updateEcriture(
  { groupId }: EcritureContext,
  id: string,
  patch: UpdateEcritureInput,
): Ecriture | null {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.date_ecriture !== undefined) { sets.push('date_ecriture = ?'); values.push(patch.date_ecriture); }
  if (patch.description !== undefined) { sets.push('description = ?'); values.push(patch.description); }
  if (patch.amount_cents !== undefined) { sets.push('amount_cents = ?'); values.push(patch.amount_cents); }
  if (patch.type !== undefined) { sets.push('type = ?'); values.push(patch.type); }
  if (patch.unite_id !== undefined) { sets.push('unite_id = ?'); values.push(patch.unite_id); }
  if (patch.category_id !== undefined) { sets.push('category_id = ?'); values.push(patch.category_id); }
  if (patch.mode_paiement_id !== undefined) { sets.push('mode_paiement_id = ?'); values.push(patch.mode_paiement_id); }
  if (patch.activite_id !== undefined) { sets.push('activite_id = ?'); values.push(patch.activite_id); }
  if (patch.numero_piece !== undefined) { sets.push('numero_piece = ?'); values.push(patch.numero_piece); }
  if (patch.justif_attendu !== undefined) { sets.push('justif_attendu = ?'); values.push(patch.justif_attendu ? 1 : 0); }
  if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
  if (patch.comptaweb_synced !== undefined) { sets.push('comptaweb_synced = ?'); values.push(patch.comptaweb_synced ? 1 : 0); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }

  if (sets.length === 0) {
    return getEcriture({ groupId }, id) ?? null;
  }

  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE ecritures SET ${sets.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getEcriture({ groupId }, id) ?? null;
}

export function updateEcritureStatus(
  ctx: EcritureContext,
  id: string,
  status: 'brouillon' | 'valide' | 'saisie_comptaweb',
): Ecriture | null {
  const patch: UpdateEcritureInput = { status };
  if (status === 'saisie_comptaweb') {
    patch.comptaweb_synced = true;
  }
  return updateEcriture(ctx, id, patch);
}
