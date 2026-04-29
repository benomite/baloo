// Stockage des justificatifs (chantier 7, ADR-018).
//
// Deux backends :
// - **FS local** : `JUSTIFICATIFS_DIR` (défaut `../justificatifs`).
//   Pratique en dev, et viable sur un VPS classique.
// - **Vercel Blob** : `BLOB_READ_WRITE_TOKEN` configuré → on bascule
//   sur `@vercel/blob` (storage S3-compatible managé). Indispensable
//   sur Vercel serverless (filesystem éphémère entre invocations).
//
// Les blobs Vercel sont uploadés en `access: 'private'` : seule l'app
// avec le token peut les lire, ce qui force tout accès à passer par
// `GET /api/justificatifs/...` qui contrôle le `group_id`. Les
// pathnames sont devinables (`<entity_type>/<entity_id>/<filename>`),
// donc le `public` historique exposait les fichiers à qui les nommait
// correctement.

import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';

export interface FetchResult {
  // `Uint8Array` pour le FS local, `ReadableStream` pour Vercel Blob.
  // Les deux sont des `BodyInit` valides côté `Response`.
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string | null;
}

interface StorageBackend {
  put(opts: { path: string; content: Buffer; contentType?: string | null }): Promise<void>;
  fetch(path: string): Promise<FetchResult | null>;
}

class FsBackend implements StorageBackend {
  constructor(private readonly rootDir: string) {}

  async put({ path: relPath, content }: { path: string; content: Buffer }): Promise<void> {
    const dest = join(this.rootDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
  }

  async fetch(relPath: string): Promise<FetchResult | null> {
    try {
      const buffer = await readFile(join(this.rootDir, relPath));
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      return { body: bytes, contentType: guessMime(relPath) };
    } catch {
      return null;
    }
  }
}

class VercelBlobBackend implements StorageBackend {
  async put({ path: relPath, content, contentType }: { path: string; content: Buffer; contentType?: string | null }): Promise<void> {
    const { put } = await import('@vercel/blob');
    await put(relPath, content, {
      access: 'private',
      contentType: contentType ?? undefined,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async fetch(relPath: string): Promise<FetchResult | null> {
    const { get } = await import('@vercel/blob');
    try {
      const result = await get(relPath, { access: 'private' });
      if (!result || result.statusCode !== 200) return null;
      return { body: result.stream, contentType: result.blob.contentType };
    } catch {
      return null;
    }
  }
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
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

export function guessMime(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] ?? null : null;
}

let cached: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (cached) return cached;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    cached = new VercelBlobBackend();
  } else {
    const root = resolve(process.cwd(), process.env.JUSTIFICATIFS_DIR || '../justificatifs');
    cached = new FsBackend(root);
  }
  return cached;
}
