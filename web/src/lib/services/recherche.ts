import { getDb } from '../db';

export interface RechercheContext {
  groupId: string;
}

export type RechercheTable = 'ecritures' | 'remboursements' | 'abandons' | 'caisse' | 'cheques';

export interface RechercheOptions {
  query: string;
  tables?: RechercheTable[];
  limit?: number;
}

export interface RechercheResults {
  query: string;
  total: number;
  resultats: Partial<Record<RechercheTable, Record<string, unknown>[]>>;
}

const ALL_TABLES: RechercheTable[] = ['ecritures', 'remboursements', 'abandons', 'caisse', 'cheques'];

export async function recherche(
  { groupId }: RechercheContext,
  options: RechercheOptions,
): Promise<RechercheResults> {
  const db = getDb();
  const q = `%${options.query}%`;
  const tables = options.tables ?? ALL_TABLES;
  const limit = options.limit ?? 10;
  const resultats: Partial<Record<RechercheTable, Record<string, unknown>[]>> = {};

  if (tables.includes('ecritures')) {
    resultats.ecritures = await db.prepare(
      `SELECT id, date_ecriture, description, amount_cents, type, status, notes
       FROM ecritures WHERE group_id = ? AND (description LIKE ? OR notes LIKE ? OR id LIKE ?)
       ORDER BY date_ecriture DESC LIMIT ?`,
    ).all<Record<string, unknown>>(groupId, q, q, q, limit);
  }

  if (tables.includes('remboursements')) {
    resultats.remboursements = await db.prepare(
      `SELECT id, demandeur, amount_cents, date_depense, nature, status, notes
       FROM remboursements WHERE group_id = ? AND (demandeur LIKE ? OR nature LIKE ? OR notes LIKE ? OR id LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    ).all<Record<string, unknown>>(groupId, q, q, q, q, limit);
  }

  if (tables.includes('abandons')) {
    resultats.abandons = await db.prepare(
      `SELECT id, donateur, amount_cents, date_depense, nature, notes
       FROM abandons_frais WHERE group_id = ? AND (donateur LIKE ? OR nature LIKE ? OR notes LIKE ? OR id LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    ).all<Record<string, unknown>>(groupId, q, q, q, q, limit);
  }

  if (tables.includes('caisse')) {
    resultats.caisse = await db.prepare(
      `SELECT id, date_mouvement, description, amount_cents, notes
       FROM mouvements_caisse WHERE group_id = ? AND (description LIKE ? OR notes LIKE ? OR id LIKE ?)
       ORDER BY date_mouvement DESC LIMIT ?`,
    ).all<Record<string, unknown>>(groupId, q, q, q, limit);
  }

  if (tables.includes('cheques')) {
    resultats.cheques = await db.prepare(
      `SELECT id, date_depot, type_depot, total_amount_cents, nombre_cheques, notes
       FROM depots_cheques WHERE group_id = ? AND (notes LIKE ? OR detail_cheques LIKE ? OR id LIKE ?)
       ORDER BY date_depot DESC LIMIT ?`,
    ).all<Record<string, unknown>>(groupId, q, q, q, limit);
  }

  const total = Object.values(resultats).reduce<number>((sum, arr) => sum + (arr?.length ?? 0), 0);

  return { query: options.query, total, resultats };
}
