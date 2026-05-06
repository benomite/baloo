import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { DepotEspeces } from '../types';

export interface DepotsEspecesContext {
  groupId: string;
}

export interface ListDepotsEspecesOptions {
  limit?: number;
  // Si true : ne retourne que ceux non encore rapprochés (ecriture_id null).
  pending_only?: boolean;
}

export async function listDepotsEspeces(
  { groupId }: DepotsEspecesContext,
  options: ListDepotsEspecesOptions = {},
): Promise<DepotEspeces[]> {
  const conditions: string[] = ['group_id = ?', 'archived_at IS NULL'];
  const values: unknown[] = [groupId];
  if (options.pending_only) conditions.push('ecriture_id IS NULL');

  return await getDb()
    .prepare(
      `SELECT * FROM depots_especes
       WHERE ${conditions.join(' AND ')}
       ORDER BY date_depot DESC, created_at DESC
       LIMIT ?`,
    )
    .all<DepotEspeces>(...values, options.limit ?? 50);
}

export async function getDepotEspeces(
  { groupId }: DepotsEspecesContext,
  id: string,
): Promise<DepotEspeces | null> {
  return (
    (await getDb()
      .prepare('SELECT * FROM depots_especes WHERE id = ? AND group_id = ?')
      .get<DepotEspeces>(id, groupId)) ?? null
  );
}

export interface CreateDepotEspecesInput {
  date_depot: string;
  total_amount_cents: number;
  detail_billets?: string | null;
  notes?: string | null;
  // Pour idempotence import. Si déjà présent, retourne le dépôt existant
  // au lieu d'en créer un nouveau.
  airtable_id?: string | null;
  // Forcer l'id (cas import historique avec numéro de pièce DEP-XXXX).
  forced_id?: string | null;
}

export async function createDepotEspeces(
  { groupId }: DepotsEspecesContext,
  input: CreateDepotEspecesInput,
): Promise<DepotEspeces> {
  const db = getDb();

  // Idempotence import : si airtable_id déjà connu, on renvoie l'existant.
  if (input.airtable_id) {
    const existing = await db
      .prepare('SELECT * FROM depots_especes WHERE group_id = ? AND airtable_id = ?')
      .get<DepotEspeces>(groupId, input.airtable_id);
    if (existing) return existing;
  }

  const id = input.forced_id ?? (await nextId('DES'));
  const now = currentTimestamp();

  await db
    .prepare(
      `INSERT INTO depots_especes
         (id, group_id, date_depot, total_amount_cents, detail_billets,
          ecriture_id, airtable_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      groupId,
      input.date_depot,
      input.total_amount_cents,
      input.detail_billets ?? null,
      input.airtable_id ?? null,
      input.notes ?? null,
      now,
    );

  return (await db
    .prepare('SELECT * FROM depots_especes WHERE id = ?')
    .get<DepotEspeces>(id))!;
}

// Liste les écritures candidates pour rapprocher un dépôt espèces.
// Critères : recette, pas encore liée à un autre dépôt, montant exact
// ou tolérance ±10%, date ±15j. Triées par proximité de montant puis
// de date.
export interface CandidateEcritureBanque {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  numero_piece: string | null;
  status: string;
}

export async function listCandidateEcrituresForDepot(
  { groupId }: DepotsEspecesContext,
  opts: { amount_cents: number; date: string; limit?: number },
): Promise<CandidateEcritureBanque[]> {
  const tol = Math.max(100, Math.round(opts.amount_cents * 0.1));
  return await getDb()
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents,
              e.numero_piece, e.status
       FROM ecritures e
       WHERE e.group_id = ?
         AND e.type = 'recette'
         AND ABS(e.amount_cents - ?) <= ?
         AND ABS(julianday(e.date_ecriture) - julianday(?)) <= 15
         AND NOT EXISTS (
           SELECT 1 FROM depots_especes d
           WHERE d.ecriture_id = e.id AND d.group_id = ?
         )
       ORDER BY ABS(e.amount_cents - ?) ASC,
                ABS(julianday(e.date_ecriture) - julianday(?)) ASC
       LIMIT ?`,
    )
    .all<CandidateEcritureBanque>(
      groupId,
      opts.amount_cents,
      tol,
      opts.date,
      groupId,
      opts.amount_cents,
      opts.date,
      opts.limit ?? 20,
    );
}

// Rattache un dépôt espèces à l'écriture banque correspondante (ligne
// "Versement espèces" sur le compte courant). UPSERT : ne renseigne
// ecriture_id que s'il était NULL (préserve un éventuel rattachement
// manuel antérieur, cf. règle "JAMAIS DELETE / toujours UPSERT").
export async function attachDepotEspecesToEcriture(
  { groupId }: DepotsEspecesContext,
  depotId: string,
  ecritureId: string,
): Promise<DepotEspeces> {
  const db = getDb();
  const depot = await getDepotEspeces({ groupId }, depotId);
  if (!depot) throw new Error(`Dépôt espèces ${depotId} introuvable.`);

  const ecriture = await db
    .prepare('SELECT id FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(ecritureId, groupId);
  if (!ecriture) throw new Error(`Écriture ${ecritureId} introuvable dans ce groupe.`);

  await db
    .prepare(
      `UPDATE depots_especes
       SET ecriture_id = COALESCE(ecriture_id, ?)
       WHERE id = ? AND group_id = ?`,
    )
    .run(ecritureId, depotId, groupId);

  // Marque tous les mouvements caisse liés comme rapprochés.
  await db
    .prepare(
      `UPDATE mouvements_caisse
       SET status = 'rapproche'
       WHERE depot_id = ? AND group_id = ?`,
    )
    .run(depotId, groupId);

  return (await getDepotEspeces({ groupId }, depotId))!;
}
