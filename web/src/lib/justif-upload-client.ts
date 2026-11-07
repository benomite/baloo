// Envoi d'un justificatif depuis le navigateur (ticket #28).
//
// Le fichier part directement vers Vercel Blob (`@vercel/blob/client`) avec
// un token signé par `/api/justificatifs/televersement` : il ne traverse
// plus la fonction serverless, donc le plafond edge Vercel (~4,5 Mo) ne
// s'applique plus. Le formulaire ne soumet ensuite qu'une `UploadRef`.
//
// Sans Blob configuré (dev local), le fichier est envoyé à la même route
// (PUT), qui l'écrit sur le FS.

import {
  MULTIPART_THRESHOLD_BYTES,
  mimeFromFilename,
  sanitizeFilename,
  validateClientFile,
  type UploadRef,
} from './justif-allowed';

export const TELEVERSEMENT_ENDPOINT = '/api/justificatifs/televersement';

interface UploaderConfig {
  mode: 'blob' | 'local';
  prefix: string;
}

let configPromise: Promise<UploaderConfig> | null = null;

function getConfig(fetchImpl: typeof fetch): Promise<UploaderConfig> {
  if (!configPromise) {
    configPromise = fetchImpl(TELEVERSEMENT_ENDPOINT, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Envoi de fichiers indisponible (session expirée ?).');
        return (await res.json()) as UploaderConfig;
      })
      .catch((err) => {
        configPromise = null; // pas de cache d'un échec
        throw err;
      });
  }
  return configPromise;
}

// Pour les tests : oublie la configuration mémorisée.
export function resetUploaderConfig(): void {
  configPromise = null;
}

export interface UploadJustifOptions {
  onProgress?: (percentage: number) => void;
  fetchImpl?: typeof fetch;
}

export async function uploadJustifFile(
  file: File,
  opts: UploadJustifOptions = {},
): Promise<UploadRef> {
  const invalid = validateClientFile(file);
  if (invalid) throw new Error(invalid);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const contentType = file.type || mimeFromFilename(file.name) || '';
  const { mode, prefix } = await getConfig(fetchImpl);

  if (mode === 'local') {
    const res = await fetchImpl(
      `${TELEVERSEMENT_ENDPOINT}?filename=${encodeURIComponent(file.name)}`,
      { method: 'PUT', body: file, headers: { 'content-type': contentType }, credentials: 'same-origin' },
    );
    const data = (await res.json().catch(() => null)) as { pathname?: string; error?: string } | null;
    if (!res.ok || !data?.pathname) throw new Error(data?.error ?? `Envoi de ${file.name} échoué.`);
    opts.onProgress?.(100);
    return { pathname: data.pathname, filename: file.name };
  }

  const { upload } = await import('@vercel/blob/client');
  const blob = await upload(`${prefix}${sanitizeFilename(file.name)}`, file, {
    // Les justificatifs restent PRIVÉS : seul `GET /api/justificatifs/...`
    // (contrôle du group_id) peut les lire. Un blob public ne serait de
    // toute façon jamais inscrit côté serveur.
    access: 'private',
    handleUploadUrl: TELEVERSEMENT_ENDPOINT,
    clientPayload: JSON.stringify({ filename: file.name, size: file.size, contentType }),
    contentType,
    multipart: file.size > MULTIPART_THRESHOLD_BYTES,
    onUploadProgress: ({ percentage }) => opts.onProgress?.(percentage),
  });
  return { pathname: blob.pathname, filename: file.name };
}
