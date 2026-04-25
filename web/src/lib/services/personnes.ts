import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface PersonneContext {
  groupId: string;
}

export const PERSONNE_ROLES = [
  'tresorier',
  'cotresorier',
  'co-rg',
  'rg',
  'secretaire_principal',
  'secretaire_adjoint',
  'responsable_com',
  'responsable_matos',
  'chef_unite',
  'cheftaine_unite',
  'parent',
  'benevole',
  'autre',
] as const;

export type PersonneRole = (typeof PERSONNE_ROLES)[number];
export type PersonneStatut = 'actif' | 'ancien' | 'inactif';

export interface Personne {
  id: string;
  group_id: string;
  prenom: string;
  nom: string | null;
  email: string | null;
  telephone: string | null;
  role_groupe: PersonneRole | null;
  unite_id: string | null;
  statut: PersonneStatut;
  depuis: string | null;
  jusqu_a: string | null;
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

function nextPersonneId(groupId: string, prenom: string, nom: string | null): string {
  const base = `per-${slugify(prenom)}${nom ? `-${slugify(nom)}` : ''}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM personnes WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

export interface ListPersonnesOptions {
  statut?: PersonneStatut;
  role?: string;
  unite_id?: string;
}

export function listPersonnes(
  { groupId }: PersonneContext,
  options: ListPersonnesOptions = {},
): Personne[] {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.statut) {
    conditions.push('statut = ?');
    values.push(options.statut);
  } else {
    conditions.push("statut = 'actif'");
  }
  if (options.role) { conditions.push('role_groupe = ?'); values.push(options.role); }
  if (options.unite_id) { conditions.push('unite_id = ?'); values.push(options.unite_id); }

  return getDb().prepare(
    `SELECT * FROM personnes WHERE ${conditions.join(' AND ')} ORDER BY role_groupe, prenom, nom`,
  ).all(...values) as Personne[];
}

export interface CreatePersonneInput {
  prenom: string;
  nom?: string | null;
  email?: string | null;
  telephone?: string | null;
  role_groupe?: PersonneRole | null;
  unite_id?: string | null;
  depuis?: string | null;
  notes?: string | null;
}

export function createPersonne(
  { groupId }: PersonneContext,
  input: CreatePersonneInput,
): Personne {
  const id = nextPersonneId(groupId, input.prenom, input.nom ?? null);
  const now = currentTimestamp();

  getDb().prepare(
    `INSERT INTO personnes (id, group_id, prenom, nom, email, telephone, role_groupe, unite_id, statut, depuis, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.prenom,
    input.nom ?? null,
    input.email ?? null,
    input.telephone ?? null,
    input.role_groupe ?? null,
    input.unite_id ?? null,
    input.depuis ?? null,
    input.notes ?? null,
    now,
    now,
  );

  return getDb().prepare('SELECT * FROM personnes WHERE id = ?').get(id) as Personne;
}

export interface UpdatePersonneInput {
  prenom?: string;
  nom?: string | null;
  email?: string | null;
  telephone?: string | null;
  role_groupe?: PersonneRole | null;
  unite_id?: string | null;
  statut?: PersonneStatut;
  depuis?: string | null;
  jusqu_a?: string | null;
  notes?: string | null;
}

export function updatePersonne(
  { groupId }: PersonneContext,
  id: string,
  patch: UpdatePersonneInput,
): Personne | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }

  if (fields.length === 0) {
    return getDb()
      .prepare('SELECT * FROM personnes WHERE id = ? AND group_id = ?')
      .get(id, groupId) as Personne | null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = getDb()
    .prepare(`UPDATE personnes SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getDb().prepare('SELECT * FROM personnes WHERE id = ?').get(id) as Personne;
}
