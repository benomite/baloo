// Migre les justificatifs locaux vers Vercel Blob.
//
// Usage typique au moment du déploiement initial :
//   1. Migrer la BDD dev → Turso :
//        sqlite3 data/baloo.db .dump | turso db shell baloo-val-de-saone
//   2. Migrer les fichiers vers Blob :
//        BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
//        DB_URL=libsql://... DB_AUTH_TOKEN=... \
//        pnpm tsx scripts/migrate-justifs-to-blob.ts
//
// - Lit la liste des justificatifs depuis la BDD (Turso si DB_URL est
//   défini, sinon le fichier SQLite local par défaut).
// - Pour chaque ligne, upload le fichier local correspondant
//   (`JUSTIFICATIFS_DIR/<file_path>`) vers Vercel Blob avec le même
//   path. La BDD n'a pas besoin d'être mise à jour : `file_path` est
//   identique entre les deux backends.
// - Idempotent : skip les blobs déjà uploadés (vérifie via `head()`).
//
// Note : ce script bypass `getStorage()` parce qu'on a besoin de LIRE
// le FS local ET d'ÉCRIRE sur Blob simultanément. `getStorage()` est
// un singleton qui choisit un seul backend selon l'env.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { put, head } from '@vercel/blob';
import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';
import { guessMime } from '../src/lib/storage';

ensureComptawebEnv();

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Erreur : BLOB_READ_WRITE_TOKEN doit être défini.');
  console.error("  Le récupérer dans Vercel → Project → Storage → Blob → '.env.local' tab.");
  process.exit(1);
}

const justifsDir = resolve(process.cwd(), process.env.JUSTIFICATIFS_DIR || '../justificatifs');

interface JustifRow {
  id: string;
  file_path: string;
  original_filename: string;
  mime_type: string | null;
}

async function main() {
  console.log(`Source : ${process.env.DB_URL ? `Turso (${process.env.DB_URL})` : `SQLite local (${process.env.DB_PATH || '../data/baloo.db'})`}`);
  console.log(`Justifs locaux : ${justifsDir}`);
  console.log(`Cible : Vercel Blob`);
  console.log();

  const rows = await getDb()
    .prepare('SELECT id, file_path, original_filename, mime_type FROM justificatifs ORDER BY uploaded_at')
    .all<JustifRow>();
  console.log(`${rows.length} justificatif(s) en BDD.\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    // 1. Skip si déjà sur Blob.
    try {
      await head(row.file_path);
      skipped++;
      console.log(`  · ${row.id} (${row.file_path}) — déjà sur Blob`);
      continue;
    } catch {
      // Not found : on continue pour upload.
    }

    // 2. Lire le fichier local.
    const localPath = resolve(justifsDir, row.file_path);
    let content: Buffer;
    try {
      content = await readFile(localPath);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${row.id} (${row.file_path}) : fichier local introuvable (${localPath})`);
      continue;
    }

    // 3. Upload sur Blob.
    try {
      const mime = row.mime_type ?? guessMime(row.original_filename);
      await put(row.file_path, content, {
        access: 'public',
        contentType: mime ?? undefined,
        addRandomSuffix: false,
      });
      uploaded++;
      console.log(`  ✓ ${row.id} (${row.file_path}) — ${(content.length / 1024).toFixed(1)} KB`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${row.id} (${row.file_path}) : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log();
  console.log(`Bilan : ${uploaded} uploadés · ${skipped} déjà présents · ${failed} en erreur.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
