import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { getStorage, guessMime } from '../storage';
import type { Justificatif } from '../types';

export interface JustificatifContext {
  groupId: string;
}

export interface ListJustificatifsOptions {
  entity_type?: string;
  entity_id?: string;
  limit?: number;
}

export async function listJustificatifs(
  { groupId }: JustificatifContext,
  options: ListJustificatifsOptions = {},
): Promise<Justificatif[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];

  if (options.entity_type) { conditions.push('entity_type = ?'); values.push(options.entity_type); }
  if (options.entity_id) { conditions.push('entity_id = ?'); values.push(options.entity_id); }

  return await getDb()
    .prepare(`SELECT * FROM justificatifs WHERE ${conditions.join(' AND ')} ORDER BY uploaded_at DESC LIMIT ?`)
    .all<Justificatif>(...values, options.limit ?? 50);
}

export interface AttachJustificatifInput {
  entity_type: string;
  entity_id: string;
  filename: string;
  content: Buffer;
  mime_type?: string | null;
}

export async function attachJustificatif(
  { groupId }: JustificatifContext,
  input: AttachJustificatifInput,
): Promise<Justificatif> {
  const relativePath = `${input.entity_type}/${input.entity_id}/${input.filename}`;
  const mime = input.mime_type ?? guessMime(input.filename);

  await getStorage().put({ path: relativePath, content: input.content, contentType: mime });

  const id = await nextId('JUS');

  await getDb().prepare(
    `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, relativePath, input.filename, mime, input.entity_type, input.entity_id, currentTimestamp());

  return (await getDb().prepare('SELECT * FROM justificatifs WHERE id = ?').get<Justificatif>(id))!;
}
