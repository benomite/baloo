'use server';

import { revalidatePath } from 'next/cache';
import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';

export async function uploadJustificatif(formData: FormData) {
  const file = formData.get('file') as File;
  const entityType = formData.get('entity_type') as string;
  const entityId = formData.get('entity_id') as string;

  if (!file || !entityType || !entityId) return;

  const justDir = resolve(process.cwd(), process.env.JUSTIFICATIFS_DIR || '../justificatifs');
  const destDir = join(justDir, entityType, entityId);
  await mkdir(destDir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  const destPath = join(destDir, file.name);
  await writeFile(destPath, buffer);

  const id = nextId('JUS');
  const relativePath = join(entityType, entityId, file.name);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const mimes: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

  getDb().prepare(`
    INSERT INTO justificatifs (id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, relativePath, file.name, ext ? mimes[ext] ?? null : null, entityType, entityId, currentTimestamp());

  revalidatePath(`/ecritures/${entityId}`);
  revalidatePath(`/remboursements/${entityId}`);
}
