// Stockage des justificatifs (chantier 7, ADR-018).
//
// Deux backends :
// - **FS local** : `JUSTIFICATIFS_DIR` (défaut `../justificatifs`).
//   Pratique en dev, et viable sur un VPS classique.
// - **Vercel Blob** : `BLOB_READ_WRITE_TOKEN` configuré → on bascule
//   sur `@vercel/blob` (storage S3-compatible managé). Indispensable
//   sur Vercel serverless (filesystem éphémère entre invocations).
//
// L'API exposée renvoie pour `put` un `path` opaque (clé de stockage)
// et un éventuel `url` direct (Vercel Blob expose une URL publique).
// La route `GET /api/justificatifs/...` route soit lit le fichier, soit
// 302-redirect vers l'URL publique selon le backend.

import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';

export interface PutResult {
  // Clé de stockage à persister en BDD (champ `justificatifs.file_path`).
  // FS : chemin relatif (`<entity_type>/<entity_id>/<filename>`).
  // Vercel Blob : `<entity_type>/<entity_id>/<filename>` aussi (utilisé
  // comme pathname du blob).
  path: string;
  // URL publique directe si le backend en expose une (Vercel Blob).
  // NULL pour FS local — la route handler sert le fichier elle-même.
  url: string | null;
}

export interface FetchResult {
  // Soit le contenu binaire (FS local), soit une URL vers laquelle
  // rediriger (Vercel Blob).
  body: Buffer | null;
  redirectUrl: string | null;
  contentType: string | null;
}

interface StorageBackend {
  put(opts: { path: string; content: Buffer; contentType?: string | null }): Promise<PutResult>;
  fetch(path: string): Promise<FetchResult | null>;
}

class FsBackend implements StorageBackend {
  constructor(private readonly rootDir: string) {}

  async put({ path: relPath, content }: { path: string; content: Buffer }): Promise<PutResult> {
    const dest = join(this.rootDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
    return { path: relPath, url: null };
  }

  async fetch(relPath: string): Promise<FetchResult | null> {
    try {
      const buffer = await readFile(join(this.rootDir, relPath));
      return { body: buffer, redirectUrl: null, contentType: guessMime(relPath) };
    } catch {
      return null;
    }
  }
}

class VercelBlobBackend implements StorageBackend {
  async put({ path: relPath, content, contentType }: { path: string; content: Buffer; contentType?: string | null }): Promise<PutResult> {
    const { put } = await import('@vercel/blob');
    const result = await put(relPath, content, {
      access: 'public',
      contentType: contentType ?? undefined,
      addRandomSuffix: false,
    });
    return { path: relPath, url: result.url };
  }

  async fetch(relPath: string): Promise<FetchResult | null> {
    // Le pathname suffit à reconstruire l'URL publique : on stocke aussi
    // bien justificatifs.file_path = chemin relatif que l'URL pleine.
    // En cas de doute, on peut aussi `head(relPath)` pour récupérer
    // l'URL canonique.
    const { head } = await import('@vercel/blob');
    try {
      const meta = await head(relPath);
      return { body: null, redirectUrl: meta.url, contentType: meta.contentType ?? null };
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
