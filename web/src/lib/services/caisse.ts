import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';
import type {
  MouvementCaisse,
  MouvementCaisseStatus,
  MouvementCaisseType,
  DepotEspeces,
} from '../types';
import { createDepotEspeces } from './depots-especes';

export interface CaisseContext {
  groupId: string;
  // Si défini, restreint aux mouvements de cette unité (vue chef).
  scopeUniteId?: string | null;
}

export interface ListMouvementsCaisseOptions {
  limit?: number;
  unite_id?: string | null;
  activite_id?: string | null;
}

export async function listMouvementsCaisse(
  { groupId, scopeUniteId }: CaisseContext,
  options: ListMouvementsCaisseOptions = {},
): Promise<{ mouvements: MouvementCaisse[]; solde: number }> {
  const db = getDb();
  const { limit = 50 } = options;

  const conditions: string[] = ['m.group_id = ?'];
  const values: unknown[] = [groupId];
  if (scopeUniteId) {
    conditions.push('m.unite_id = ?');
    values.push(scopeUniteId);
  } else if (options.unite_id) {
    conditions.push('m.unite_id = ?');
    values.push(options.unite_id);
  }
  if (options.activite_id) {
    conditions.push('m.activite_id = ?');
    values.push(options.activite_id);
  }

  // Soft-delete : on exclut les lignes archivées de la liste et du
  // solde par défaut (cf. archiveOrphanedCaisseRows dans caisse-sync).
  conditions.push('m.archived_at IS NULL');
  const where = `WHERE ${conditions.join(' AND ')}`;

  const mouvements = await db
    .prepare(
      `SELECT m.*, u.code AS unite_code, a.name AS activite_name
       FROM mouvements_caisse m
       LEFT JOIN unites u ON u.id = m.unite_id
       LEFT JOIN activites a ON a.id = m.activite_id
       ${where}
       ORDER BY m.date_mouvement DESC, m.created_at DESC LIMIT ?`,
    )
    .all<MouvementCaisse & { unite_code?: string | null; activite_name?: string | null }>(
      ...values,
      limit,
    );

  const soldeRow = await db
    .prepare(`SELECT COALESCE(SUM(m.amount_cents), 0) as total FROM mouvements_caisse m ${where}`)
    .get<{ total: number }>(...values);

  return { mouvements, solde: soldeRow?.total ?? 0 };
}

export interface CreateMouvementCaisseInput {
  date_mouvement: string;
  description: string;
  amount_cents: number;
  // Optionnel : si non fourni, inféré du signe (positif=entree, negatif=sortie).
  // Sauf 'depot' qui doit être explicite (signal sortie vers banque).
  type?: MouvementCaisseType | null;
  numero_piece?: string | null;
  status?: MouvementCaisseStatus;
  depot_id?: string | null;
  airtable_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  notes?: string | null;
}

export async function createMouvementCaisse(
  { groupId }: CaisseContext,
  input: CreateMouvementCaisseInput,
): Promise<MouvementCaisse> {
  const db = getDb();

  // Idempotence import : si airtable_id déjà connu, retourne l'existant.
  if (input.airtable_id) {
    const existing = await db
      .prepare('SELECT * FROM mouvements_caisse WHERE group_id = ? AND airtable_id = ?')
      .get<MouvementCaisse>(groupId, input.airtable_id);
    if (existing) return existing;
  }

  const id = await nextId('CAI');
  const now = currentTimestamp();

  const inferredType: MouvementCaisseType =
    input.type ?? (input.amount_cents >= 0 ? 'entree' : 'sortie');

  // Solde "global" du groupe — `solde_apres_cents` reste un running
  // total non scoped même en présence d'unite_id, pour rester cohérent
  // avec l'historique existant.
  const soldeBefore = await db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
    .get<{ total: number }>(groupId);
  const soldeAfter = (soldeBefore?.total ?? 0) + input.amount_cents;

  await db
    .prepare(
      `INSERT INTO mouvements_caisse
         (id, group_id, date_mouvement, description, amount_cents,
          type, numero_piece, status, depot_id, airtable_id,
          unite_id, activite_id, solde_apres_cents, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      groupId,
      input.date_mouvement,
      input.description,
      input.amount_cents,
      inferredType,
      nullIfEmpty(input.numero_piece),
      input.status ?? 'saisi',
      nullIfEmpty(input.depot_id),
      nullIfEmpty(input.airtable_id),
      nullIfEmpty(input.unite_id),
      nullIfEmpty(input.activite_id),
      soldeAfter,
      nullIfEmpty(input.notes),
      now,
    );

  return (await db.prepare('SELECT * FROM mouvements_caisse WHERE id = ?').get<MouvementCaisse>(id))!;
}

// Crée un dépôt espèces (entrée dans la table depots_especes) ET le
// mouvement caisse négatif lié (sortie d'argent de la caisse). Les
// deux sont marqués 'depose' (en attente du rapprochement banque).
//
// Pas de transaction explicite : libsql remote ne supporte pas les
// transactions multi-statement. Sécurité acceptée car même en cas
// d'échec partiel, on peut re-jouer l'opération (pas de doublon car
// pas d'airtable_id ici).
export interface CreateDepotEspecesAvecMouvementInput {
  date_depot: string;
  total_amount_cents: number;
  description?: string | null;
  detail_billets?: string | null;
  notes?: string | null;
}

export async function createDepotEspecesAvecMouvement(
  { groupId }: CaisseContext,
  input: CreateDepotEspecesAvecMouvementInput,
): Promise<{ depot: DepotEspeces; mouvement: MouvementCaisse }> {
  if (input.total_amount_cents <= 0) {
    throw new Error('Le montant du dépôt doit être strictement positif.');
  }

  const depot = await createDepotEspeces(
    { groupId },
    {
      date_depot: input.date_depot,
      total_amount_cents: input.total_amount_cents,
      detail_billets: input.detail_billets,
      notes: input.notes,
    },
  );

  const description = input.description?.trim() || `Dépôt en banque ${input.date_depot}`;

  const mouvement = await createMouvementCaisse(
    { groupId },
    {
      date_mouvement: input.date_depot,
      description,
      amount_cents: -Math.abs(input.total_amount_cents),
      type: 'depot',
      numero_piece: depot.id,
      status: 'depose',
      depot_id: depot.id,
      notes: input.notes,
    },
  );

  return { depot, mouvement };
}
