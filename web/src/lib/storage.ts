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

import { writeFile, mkdir, readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { mimeFromFilename } from './justif-allowed';

export interface FetchResult {
  // `Uint8Array` pour le FS local, `ReadableStream` pour Vercel Blob.
  // Les deux sont des `BodyInit` valides côté `Response`.
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string | null;
}

// Métadonnées d'un fichier déjà stocké (sans le lire). Sert à confirmer
// côté serveur un téléversement direct client → Blob quand le callback
// `onUploadCompleted` ne passe pas (dev local, cf. justif-televersements).
export interface StoredFileInfo {
  size: number;
  contentType: string | null;
  // URL du blob (Vercel Blob uniquement) : permet de vérifier qu'il est privé.
  url: string | null;
}

interface StorageBackend {
  put(opts: { path: string; content: Buffer; contentType?: string | null }): Promise<void>;
  fetch(path: string): Promise<FetchResult | null>;
  head(path: string): Promise<StoredFileInfo | null>;
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

  async head(relPath: string): Promise<StoredFileInfo | null> {
    try {
      const s = await stat(join(this.rootDir, relPath));
      return { size: s.size, contentType: guessMime(relPath), url: null };
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

  async head(relPath: string): Promise<StoredFileInfo | null> {
    const { head } = await import('@vercel/blob');
    try {
      const meta = await head(relPath);
      return { size: meta.size, contentType: meta.contentType ?? null, url: meta.url };
    } catch {
      return null;
    }
  }
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '.' : p.slice(0, i);
}

export function guessMime(filename: string): string | null {
  return mimeFromFilename(filename);
}

// Mode de stockage courant. `blob` : les justificatifs partent directement
// du navigateur vers Vercel Blob (route `/api/justificatifs/televersement`).
// `local` : pas de Blob configuré (dev) → le navigateur envoie le fichier à
// cette même route, qui l'écrit sur le FS.
export function storageMode(): 'blob' | 'local' {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local';
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
