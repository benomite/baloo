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

function nextCompteId(groupId: string, code: string): string {
  const base = `cpt-${slugify(code)}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM comptes_bancaires WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

export interface ListComptesOptions {
  statut?: CompteStatut;
}

export function listComptesBancaires(
  { groupId }: ComptesContext,
  options: ListComptesOptions = {},
): CompteBancaire[] {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.statut) {
    conditions.push('statut = ?');
    values.push(options.statut);
  } else {
    conditions.push("statut = 'actif'");
  }

  return getDb().prepare(
    `SELECT * FROM comptes_bancaires WHERE ${conditions.join(' AND ')} ORDER BY type_compte, nom`,
  ).all(...values) as CompteBancaire[];
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

export function createCompteBancaire(
  { groupId }: ComptesContext,
  input: CreateCompteInput,
): CompteBancaire {
  const id = nextCompteId(groupId, input.code);
  const now = currentTimestamp();

  getDb().prepare(
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

  return getDb().prepare('SELECT * FROM comptes_bancaires WHERE id = ?').get(id) as CompteBancaire;
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

export function updateCompteBancaire(
  { groupId }: ComptesContext,
  id: string,
  patch: UpdateCompteInput,
): CompteBancaire | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }

  if (fields.length === 0) {
    return getDb()
      .prepare('SELECT * FROM comptes_bancaires WHERE id = ? AND group_id = ?')
      .get(id, groupId) as CompteBancaire | null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE comptes_bancaires SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getDb().prepare('SELECT * FROM comptes_bancaires WHERE id = ?').get(id) as CompteBancaire;
}
