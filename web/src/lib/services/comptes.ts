import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface ComptesContext {
  groupId: string;
}

export const COMPTE_TYPES = ['courant', 'livret', 'caisse', 'autre'] as const;
export const COMPTE_STATUTS = ['actif', 'ferme'] as const;

export type CompteType = (typeof COMPTE_TYPES)[number];
export type CompteStatut = (typeof COMPTE_STATUTS)[number];

export interface CompteBancaire {
  id: string;
  group_id: string;
  code: string;
  nom: string;
  banque: string | null;
  iban: string | null;
  bic: string | null;
  type_compte: CompteType | null;
  comptaweb_id: number | null;
  statut: CompteStatut;
  ouvert_le: string | null;
  ferme_le: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function nextCompteId(groupId: string, code: string): Promise<string> {
  const base = `cpt-${slugify(code)}`;
  const existing = await getDb()
    .prepare('SELECT COUNT(*) AS n FROM comptes_bancaires WHERE group_id = ? AND id LIKE ?')
    .get<{ n: number }>(groupId, `${base}%`);
  const n = existing?.n ?? 0;
  return n === 0 ? base : `${base}-${n + 1}`;
}

export interface ListComptesOptions {
  statut?: CompteStatut;
}

export async function listComptesBancaires(
  { groupId }: ComptesContext,
  options: ListComptesOptions = {},
): Promise<CompteBancaire[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.statut) {
    conditions.push('statut = ?');
    values.push(options.statut);
  } else {
    conditions.push("statut = 'actif'");
  }

  return await getDb().prepare(
    `SELECT * FROM comptes_bancaires WHERE ${conditions.join(' AND ')} ORDER BY type_compte, nom`,
  ).all<CompteBancaire>(...values);
}

export interface CreateCompteInput {
  code: string;
  nom: string;
  banque?: string | null;
  iban?: string | null;
  bic?: string | null;
  type_compte?: CompteType | null;
  comptaweb_id?: number | null;
  ouvert_le?: string | null;
  notes?: string | null;
}

export async function createCompteBancaire(
  { groupId }: ComptesContext,
  input: CreateCompteInput,
): Promise<CompteBancaire> {
  const id = await nextCompteId(groupId, input.code);
  const now = currentTimestamp();

  await getDb().prepare(
    `INSERT INTO comptes_bancaires (id, group_id, code, nom, banque, iban, bic, type_compte, comptaweb_id, statut, ouvert_le, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.code,
    input.nom,
    input.banque ?? null,
    input.iban ?? null,
    input.bic ?? null,
    input.type_compte ?? null,
    input.comptaweb_id ?? null,
    input.ouvert_le ?? null,
    input.notes ?? null,
    now,
    now,
  );

  return (await getDb().prepare('SELECT * FROM comptes_bancaires WHERE id = ?').get<CompteBancaire>(id))!;
}

export interface UpdateCompteInput {
  nom?: string;
  banque?: string | null;
  iban?: string | null;
  bic?: string | null;
  type_compte?: CompteType;
  comptaweb_id?: number | null;
  statut?: CompteStatut;
  ouvert_le?: string | null;
  ferme_le?: string | null;
  notes?: string | null;
}

export async function updateCompteBancaire(
  { groupId }: ComptesContext,
  id: string,
  patch: UpdateCompteInput,
): Promise<CompteBancaire | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }

  if (fields.length === 0) {
    return (await getDb()
      .prepare('SELECT * FROM comptes_bancaires WHERE id = ? AND group_id = ?')
      .get<CompteBancaire>(id, groupId)) ?? null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = await getDb()
    .prepare(`UPDATE comptes_bancaires SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return (await getDb().prepare('SELECT * FROM comptes_bancaires WHERE id = ?').get<CompteBancaire>(id))!;
}
