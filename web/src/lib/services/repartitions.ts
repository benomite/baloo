import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import {
  validateRepartitionInput,
  type RepartitionValidationInput,
} from './repartitions-validation';

export interface RepartitionContext {
  groupId: string;
}

export interface Repartition {
  id: string;
  group_id: string;
  date_repartition: string;
  saison: string;
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRepartitionInput {
  date_repartition: string;
  saison: string;
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
  notes?: string | null;
}

export type UpdateRepartitionInput = Partial<{
  date_repartition: string;
  saison: string;
  montant_cents: number;
  libelle: string;
  notes: string | null;
}>;
// Note : pas de unite_source_id / unite_cible_id en update — pour
// changer la source/cible, supprimer et recréer (cohérence sémantique).

export class RepartitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepartitionValidationError';
  }
}

export interface ListRepartitionsOptions {
  saison?: string;
}

export async function listRepartitions(
  { groupId }: RepartitionContext,
  options: ListRepartitionsOptions = {},
): Promise<Repartition[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];
  if (options.saison) { conditions.push('saison = ?'); values.push(options.saison); }
  return await getDb()
    .prepare(`SELECT * FROM repartitions_unites WHERE ${conditions.join(' AND ')} ORDER BY date_repartition DESC, id DESC`)
    .all<Repartition>(...values);
}

export async function createRepartition(
  { groupId }: RepartitionContext,
  input: CreateRepartitionInput,
): Promise<Repartition> {
  const validation: RepartitionValidationInput = {
    date_repartition: input.date_repartition,
    saison: input.saison,
    montant_cents: input.montant_cents,
    unite_source_id: input.unite_source_id,
    unite_cible_id: input.unite_cible_id,
    libelle: input.libelle,
  };
  const err = validateRepartitionInput(validation);
  if (err) throw new RepartitionValidationError(err);

  const db = getDb();
  const id = `rep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = currentTimestamp();
  await db.prepare(
    `INSERT INTO repartitions_unites (id, group_id, date_repartition, saison, montant_cents, unite_source_id, unite_cible_id, libelle, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.date_repartition,
    input.saison,
    input.montant_cents,
    input.unite_source_id,
    input.unite_cible_id,
    input.libelle.trim(),
    input.notes?.trim() || null,
    now,
    now,
  );
  return (await db.prepare('SELECT * FROM repartitions_unites WHERE id = ?').get<Repartition>(id))!;
}

// Anti-énumération inter-groupes : retourne null si la répartition
// n'appartient pas au groupe courant.
export async function updateRepartition(
  { groupId }: RepartitionContext,
  id: string,
  patch: UpdateRepartitionInput,
): Promise<Repartition | null> {
  const db = getDb();
  const existing = await db
    .prepare('SELECT * FROM repartitions_unites WHERE id = ? AND group_id = ?')
    .get<Repartition>(id, groupId);
  if (!existing) return null;

  // Valider l'état projeté après patch (sauf source/cible qui ne changent pas).
  const merged: RepartitionValidationInput = {
    date_repartition: patch.date_repartition ?? existing.date_repartition,
    saison: patch.saison ?? existing.saison,
    montant_cents: patch.montant_cents ?? existing.montant_cents,
    unite_source_id: existing.unite_source_id,
    unite_cible_id: existing.unite_cible_id,
    libelle: patch.libelle ?? existing.libelle,
  };
  const err = validateRepartitionInput(merged);
  if (err) throw new RepartitionValidationError(err);

  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.date_repartition !== undefined) { sets.push('date_repartition = ?'); values.push(patch.date_repartition); }
  if (patch.saison !== undefined) { sets.push('saison = ?'); values.push(patch.saison); }
  if (patch.montant_cents !== undefined) { sets.push('montant_cents = ?'); values.push(patch.montant_cents); }
  if (patch.libelle !== undefined) { sets.push('libelle = ?'); values.push(patch.libelle.trim()); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes?.trim() || null); }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id);
  await db.prepare(`UPDATE repartitions_unites SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return (await db.prepare('SELECT * FROM repartitions_unites WHERE id = ?').get<Repartition>(id))!;
}

export async function deleteRepartition(
  { groupId }: RepartitionContext,
  id: string,
): Promise<boolean> {
  const db = getDb();
  const owned = await db
    .prepare('SELECT id FROM repartitions_unites WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(id, groupId);
  if (!owned) return false;
  await db.prepare('DELETE FROM repartitions_unites WHERE id = ?').run(id);
  return true;
}

// Net (entrantes - sortantes) par unité, restreint à une saison.
// Map<unite_id, net_cents>. Les répartitions "Groupe" (source ou cible NULL)
// ne contribuent que du côté unité — le solde Groupe n'est pas calculé ici
// (il vit ailleurs si besoin).
export async function getRepartitionsNetByUnite(
  { groupId }: RepartitionContext,
  saison: string,
): Promise<Record<string, number>> {
  const rows = await getDb()
    .prepare(
      `SELECT unite_cible_id as unite_id, SUM(montant_cents) as total
       FROM repartitions_unites
       WHERE group_id = ? AND saison = ? AND unite_cible_id IS NOT NULL
       GROUP BY unite_cible_id`,
    )
    .all<{ unite_id: string; total: number }>(groupId, saison);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.unite_id] = (out[r.unite_id] ?? 0) + r.total;
  const sortantes = await getDb()
    .prepare(
      `SELECT unite_source_id as unite_id, SUM(montant_cents) as total
       FROM repartitions_unites
       WHERE group_id = ? AND saison = ? AND unite_source_id IS NOT NULL
       GROUP BY unite_source_id`,
    )
    .all<{ unite_id: string; total: number }>(groupId, saison);
  for (const r of sortantes) out[r.unite_id] = (out[r.unite_id] ?? 0) - r.total;
  return out;
}
