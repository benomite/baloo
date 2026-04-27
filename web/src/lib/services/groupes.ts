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

export async function getGroupe({ groupId }: GroupeContext): Promise<Groupe | undefined> {
  return await getDb().prepare('SELECT * FROM groupes WHERE id = ?').get<Groupe>(groupId);
}

export interface UpdateGroupeInput {
  nom?: string;
  territoire?: string | null;
  adresse?: string | null;
  email_contact?: string | null;
  iban_principal?: string | null;
  notes?: string | null;
}

export async function updateGroupe(
  { groupId }: GroupeContext,
  patch: UpdateGroupeInput,
): Promise<Groupe | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }

  if (fields.length === 0) {
    return (await getGroupe({ groupId })) ?? null;
  }

  fields.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(groupId);

  const result = await getDb()
    .prepare(`UPDATE groupes SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
  if (result.changes === 0) return null;

  return (await getGroupe({ groupId })) ?? null;
}
