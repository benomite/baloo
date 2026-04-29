// Migre les justificatifs déjà uploadés en `access: 'public'` vers
// `access: 'private'`. À lancer une fois après le passage du backend
// Vercel Blob en privé (cf. lib/storage.ts).
//
// Stratégie idempotente :
//  - Pour chaque ligne `justificatifs`, tente `get(pathname, { access:
//    'private' })`. Si OK → blob déjà privé, skip.
//  - Sinon (mismatch d'access ou not found en private), récupère via
//    `head()` + fetch sur l'URL publique retournée, puis ré-upload en
//    `private` avec `allowOverwrite: true`. Le pathname (clé de
//    stockage) est préservé — la BDD n'a rien à mettre à jour.
//
// Usage :
//   cd web
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
//   DB_URL=libsql://... DB_AUTH_TOKEN=... \
//   pnpm tsx scripts/migrate-blobs-to-private.ts [--dry-run]

import { getDb } from '../src/lib/db';

interface JustifRow {
  id: string;
  file_path: string;
  mime_type: string | null;
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN requis (token Vercel Blob).');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');

  const { get, head, put } = await import('@vercel/blob');

  const justifs = await getDb()
    .prepare('SELECT id, file_path, mime_type FROM justificatifs ORDER BY uploaded_at')
    .all<JustifRow>();

  console.log(`${justifs.length} justificatif(s) à examiner${dryRun ? ' (DRY RUN)' : ''}.`);

  let alreadyPrivate = 0;
  let migrated = 0;
  let missing = 0;
  let failed = 0;

  for (const j of justifs) {
    try {
      const isPrivate = await isAlreadyPrivate(get, j.file_path);
      if (isPrivate) {
        alreadyPrivate++;
        continue;
      }

      const meta = await head(j.file_path).catch(() => null);
      if (!meta) {
        console.warn(`[${j.id}] introuvable sur le store : ${j.file_path}`);
        missing++;
        continue;
      }

      if (dryRun) {
        console.log(`[${j.id}] migrerait ${j.file_path} (${meta.size} B)`);
        migrated++;
        continue;
      }

      const response = await fetch(meta.url);
      if (!response.ok) {
        throw new Error(`fetch URL publique échoué : HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      await put(j.file_path, buffer, {
        access: 'private',
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: meta.contentType ?? j.mime_type ?? undefined,
      });
      console.log(`[${j.id}] migré (${buffer.length} B)`);
      migrated++;
    } catch (err) {
      console.error(`[${j.id}] échec :`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log('---');
  console.log(`Déjà privés : ${alreadyPrivate}`);
  console.log(`Migrés${dryRun ? ' (simulés)' : ''} : ${migrated}`);
  console.log(`Introuvables : ${missing}`);
  console.log(`Échecs : ${failed}`);
  if (failed > 0) process.exit(2);
}

// Tente de récupérer le blob en mode privé. Si OK → c'est déjà migré.
// Sinon → on suppose qu'il est public (ou inexistant, traité par head).
async function isAlreadyPrivate(
  get: typeof import('@vercel/blob').get,
  pathname: string,
): Promise<boolean> {
  try {
    const result = await get(pathname, { access: 'private', useCache: false });
    return result?.statusCode === 200;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
