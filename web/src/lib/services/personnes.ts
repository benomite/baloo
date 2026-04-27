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

async function nextPersonneId(groupId: string, prenom: string, nom: string | null): Promise<string> {
  const base = `per-${slugify(prenom)}${nom ? `-${slugify(nom)}` : ''}`;
  const existing = await getDb()
    .prepare('SELECT COUNT(*) AS n FROM personnes WHERE group_id = ? AND id LIKE ?')
    .get<{ n: number }>(groupId, `${base}%`);
  const n = existing?.n ?? 0;
  return n === 0 ? base : `${base}-${n + 1}`;
}

export interface ListPersonnesOptions {
  statut?: PersonneStatut;
  role?: string;
  unite_id?: string;
}

export async function listPersonnes(
  { groupId }: PersonneContext,
  options: ListPersonnesOptions = {},
): Promise<Personne[]> {
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

  return await getDb().prepare(
    `SELECT * FROM personnes WHERE ${conditions.join(' AND ')} ORDER BY role_groupe, prenom, nom`,
  ).all<Personne>(...values);
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

export async function createPersonne(
  { groupId }: PersonneContext,
  input: CreatePersonneInput,
): Promise<Personne> {
  const id = await nextPersonneId(groupId, input.prenom, input.nom ?? null);
  const now = currentTimestamp();

  await getDb().prepare(
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

  return (await getDb().prepare('SELECT * FROM personnes WHERE id = ?').get<Personne>(id))!;
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

export async function updatePersonne(
  { groupId }: PersonneContext,
  id: string,
  patch: UpdatePersonneInput,
): Promise<Personne | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }

  if (fields.length === 0) {
    return (await getDb()
      .prepare('SELECT * FROM personnes WHERE id = ? AND group_id = ?')
      .get<Personne>(id, groupId)) ?? null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id, groupId);

  const result = await getDb()
    .prepare(`UPDATE personnes SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return (await getDb().prepare('SELECT * FROM personnes WHERE id = ?').get<Personne>(id))!;
}
