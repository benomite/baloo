// Réattache les fichiers présents dans `justificatifs/<entity_type>/<id>/`
// à leur entité comptable (table `justificatifs`).

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb } from '../src/lib/db';
import { currentTimestamp, nextId } from '../src/lib/ids';
import { getCliContext } from './cli-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const JUSTIFICATIFS_DIR = resolve(REPO_ROOT, 'justificatifs');

function getMimeType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
  };
  return mimes[ext] ?? null;
}

async function main() {
  const ctx = await getCliContext();
  const db = getDb();

  const entityTypes = readdirSync(JUSTIFICATIFS_DIR).filter((d) => {
    try {
      return statSync(join(JUSTIFICATIFS_DIR, d)).isDirectory();
    } catch {
      return false;
    }
  });

  let inserted = 0;
  let skippedExisting = 0;
  let skippedMissing = 0;

  for (const entityType of entityTypes) {
    const typeDir = join(JUSTIFICATIFS_DIR, entityType);
    const entityIds = readdirSync(typeDir).filter((d) => {
      try {
        return statSync(join(typeDir, d)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const entityId of entityIds) {
      const targetTable =
        entityType === 'ecriture'
          ? 'ecritures'
          : entityType === 'remboursement'
            ? 'remboursements'
            : entityType === 'abandon'
              ? 'abandons_frais'
              : entityType === 'depot'
                ? 'depots_cheques'
                : entityType === 'mouvement'
                  ? 'mouvements_caisse'
                  : null;
      if (!targetTable) {
        console.log(`  ?? type inconnu ${entityType}/${entityId}, skip`);
        continue;
      }
      const entityExists = !!(await db.prepare(`SELECT 1 FROM ${targetTable} WHERE id = ?`).get(entityId));
      if (!entityExists) {
        console.log(`  !! entité absente ${entityType}/${entityId}, skip`);
        skippedMissing++;
        continue;
      }

      const files = readdirSync(join(typeDir, entityId)).filter((f) => !f.startsWith('.'));
      for (const file of files) {
        const relativePath = join(entityType, entityId, file);
        const alreadyAttached = await db
          .prepare(
            'SELECT 1 FROM justificatifs WHERE entity_type = ? AND entity_id = ? AND file_path = ?',
          )
          .get(entityType, entityId, relativePath);
        if (alreadyAttached) {
          skippedExisting++;
          continue;
        }
        const id = await nextId('JUS');
        const mimeType = getMimeType(file);
        await db.prepare(
          `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, ctx.groupId, relativePath, file, mimeType, entityType, entityId, currentTimestamp());
        console.log(`  + ${id}  ${entityType}/${entityId}/${file}`);
        inserted++;
      }
    }
  }

  console.log(
    `\nRéattachement : ${inserted} insérés, ${skippedExisting} déjà présents, ${skippedMissing} entités manquantes.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
