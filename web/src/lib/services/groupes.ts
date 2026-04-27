import { getDb } from '../db';
import { currentTimestamp } from '../ids';

export interface GroupeContext {
  groupId: string;
}

export interface Groupe {
  id: string;
  code: string;
  nom: string;
  territoire: string | null;
  adresse: string | null;
  email_contact: string | null;
  iban_principal: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function getGroupe({ groupId }: GroupeContext): Groupe | undefined {
  return getDb().prepare('SELECT * FROM groupes WHERE id = ?').get(groupId) as Groupe | undefined;
}

export interface UpdateGroupeInput {
  nom?: string;
  territoire?: string | null;
  adresse?: string | null;
  email_contact?: string | null;
  iban_principal?: string | null;
  notes?: string | null;
}

export function updateGroupe(
  { groupId }: GroupeContext,
  patch: UpdateGroupeInput,
): Groupe | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }

  if (fields.length === 0) {
    return getGroupe({ groupId }) ?? null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(groupId);

  const result = getDb()
    .prepare(`UPDATE groupes SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return getGroupe({ groupId }) ?? null;
}
