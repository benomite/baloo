import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import type { Justificatif } from '../types';

export interface JustificatifContext {
  groupId: string;
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

function guessMimeType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] ?? null : null;
}

function justificatifsDir(): string {
  return resolve(process.cwd(), process.env.JUSTIFICATIFS_DIR || '../justificatifs');
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
  const destDir = join(justificatifsDir(), input.entity_type, input.entity_id);
  await mkdir(destDir, { recursive: true });
  await writeFile(join(destDir, input.filename), input.content);

  const id = await nextId('JUS');
  const relativePath = join(input.entity_type, input.entity_id, input.filename);
  const mime = input.mime_type ?? guessMimeType(input.filename);

  await getDb().prepare(
    `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, groupId, relativePath, input.filename, mime, input.entity_type, input.entity_id, currentTimestamp());

  return (await getDb().prepare('SELECT * FROM justificatifs WHERE id = ?').get<Justificatif>(id))!;
}
