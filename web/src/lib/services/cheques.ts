import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { DepotType } from '../types';

export interface ChequesContext {
  groupId: string;
}

export interface DepotCheques {
  id: string;
  group_id: string;
  date_depot: string;
  type_depot: DepotType;
  total_amount_cents: number;
  nombre_cheques: number;
  detail_cheques: string | null;
  confirmation_status: 'en_attente' | 'confirme';
  notes: string | null;
  created_at: string;
}

export interface ListDepotChequesOptions {
  type_depot?: DepotType;
  confirmation_status?: 'en_attente' | 'confirme';
  limit?: number;
}

export async function listDepotsCheques(
  { groupId }: ChequesContext,
  options: ListDepotChequesOptions = {},
): Promise<DepotCheques[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.type_depot) { conditions.push('type_depot = ?'); values.push(options.type_depot); }
  if (options.confirmation_status) { conditions.push('confirmation_status = ?'); values.push(options.confirmation_status); }

  return await getDb().prepare(
    `SELECT * FROM depots_cheques WHERE ${conditions.join(' AND ')} ORDER BY date_depot DESC LIMIT ?`,
  ).all<DepotCheques>(...values, options.limit ?? 50);
}

export interface ChequeInput {
  emetteur: string;
  amount_cents: number;
  numero?: string | null;
}

export interface CreateDepotChequesInput {
  date_depot: string;
  type_depot: DepotType;
  cheques: ChequeInput[];
  notes?: string | null;
}

export async function createDepotCheques(
  { groupId }: ChequesContext,
  input: CreateDepotChequesInput,
): Promise<DepotCheques> {
  const db = getDb();
  const id = await nextId('DCH');
  const now = currentTimestamp();

  const detail = input.cheques.map((c) => ({
    emetteur: c.emetteur,
    montant_cents: c.amount_cents,
    numero: c.numero ?? null,
  }));
  const totalCents = detail.reduce((sum, c) => sum + c.montant_cents, 0);

  await db.prepare(
    `INSERT INTO depots_cheques (id, group_id, date_depot, type_depot, total_amount_cents, nombre_cheques, detail_cheques, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.date_depot,
    input.type_depot,
    totalCents,
    detail.length,
    JSON.stringify(detail),
    input.notes ?? null,
    now,
  );

  return (await db.prepare('SELECT * FROM depots_cheques WHERE id = ?').get<DepotCheques>(id))!;
}
