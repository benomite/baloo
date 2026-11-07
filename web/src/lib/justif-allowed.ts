// Whitelist des fichiers acceptés en justificatif (extension + MIME) et
// taille max. Module **pur** (aucune dépendance BDD / serveur) pour être
// importable aussi bien côté serveur (`services/justificatifs.ts`, route de
// signature d'upload) que côté client (uploader, validation avant envoi).
// Source de vérité unique : éviter deux listes qui divergent.
//
// HEIC inclus pour les photos iOS prises directement depuis l'app.

export const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
  'csv', 'xlsx', 'xls',
]);

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

// MIME déduit de l'extension, pour les fichiers dont le navigateur ne
// renseigne pas le type (drag&drop, HEIC sur certains OS). Couvre toute la
// whitelist : l'upload direct vers Vercel Blob exige un content-type
// autorisé par le token.
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

// Taille max d'UN fichier. Les justificatifs partent directement du
// navigateur vers Vercel Blob (`@vercel/blob/client`, ticket #28) : ils ne
// traversent plus la fonction serverless, donc le plafond edge Vercel
// (~4,5 Mo de body, 413 opaque) ne s'applique plus. La limite technique
// devient celle de Blob (~5 Go) ; on garde un plafond métier raisonnable
// pour un justificatif (scan PDF multi-pages, vidéo exclue). Cette
// constante est imposée côté serveur dans le token d'upload
// (`maximumSizeInBytes`) : c'est la vraie limite, pas un affichage.
export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// Au-delà, l'upload client passe en multipart (morceaux parallèles,
// reprise sur erreur réseau) : utile sur mobile pour les gros PDF.
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

export function formatMo(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} Mo`;
}

// Libellé humain de la limite, réutilisé dans les messages et les hints.
export const MAX_FILE_SIZE_LABEL = formatMo(MAX_FILE_SIZE_BYTES);

// Libellé humain des formats autorisés, réutilisé dans les messages.
export const ALLOWED_LABEL = 'PDF, JPG, PNG, GIF, WEBP, HEIC, CSV, XLS(X)';

// Valeur d'attribut `accept` cohérente avec la whitelist (hint du
// sélecteur de fichiers ; ne remplace pas la validation).
export const ALLOWED_ACCEPT =
  'image/*,application/pdf,.csv,.xls,.xlsx,.heic,.heif';

export function extOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function mimeFromFilename(filename: string): string | null {
  return MIME_BY_EXTENSION[extOf(filename)] ?? null;
}

// Référence d'un fichier déjà téléversé (navigateur → storage), soumise
// par le formulaire dans un input caché (JSON) à la place du fichier.
export interface UploadRef {
  pathname: string;
  filename: string;
}

// Nom de fichier sûr pour un pathname de storage (et pour la route de
// lecture `[...path]`, qui refuse `/`, `\` et `..`). Le nom d'origine est
// conservé à part (`original_filename`).
export function sanitizeFilename(name: string): string {
  const ext = extOf(name);
  const hasExt = name.includes('.') && ext.length > 0;
  const base = (hasExt ? name.slice(0, -(ext.length + 1)) : name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  const safeExt = hasExt ? ext.replace(/[^a-z0-9]/g, '') : '';
  return `${base || 'fichier'}${safeExt ? `.${safeExt}` : ''}`;
}

// Validation commune (client ET serveur) d'un fichier décrit par ses
// métadonnées. Retourne un message utilisateur, ou `null` si accepté.
// `size` à `null` = inconnue (la taille est alors bornée ailleurs, par le
// token d'upload). Le MIME n'est rejeté que s'il est présent ET inconnu :
// le navigateur ne le renseigne pas toujours.
export function checkJustifMeta(opts: {
  filename: string;
  size: number | null;
  mime_type?: string | null;
}): string | null {
  if (opts.size !== null && opts.size > MAX_FILE_SIZE_BYTES) {
    return `Fichier trop volumineux (${formatMo(opts.size)}). Limite : ${MAX_FILE_SIZE_LABEL}.`;
  }
  const ext = extOf(opts.filename);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Type de fichier non autorisé : .${ext || '(sans extension)'}. Autorisés : ${ALLOWED_LABEL}.`;
  }
  if (opts.mime_type && !ALLOWED_MIME_TYPES.has(opts.mime_type)) {
    return `Type MIME non autorisé : ${opts.mime_type}.`;
  }
  return null;
}

// Validation côté client (avant envoi). Même logique que
// `validateJustifAttachment` côté serveur — qui reste l'autorité, avec la
// route de signature d'upload.
export function validateClientFile(file: File): string | null {
  const err = checkJustifMeta({ filename: file.name, size: file.size, mime_type: file.type || null });
  return err ? `${file.name} : ${err}` : null;
}
