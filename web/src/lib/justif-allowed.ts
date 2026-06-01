// Whitelist des fichiers acceptés en justificatif (extension + MIME) et
// taille max. Module **pur** (aucune dépendance BDD / serveur) pour être
// importable aussi bien côté serveur (`services/justificatifs.ts`) que
// côté client (uploader, validation avant submit). Source de vérité
// unique : éviter deux listes qui divergent.
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

// La taille max double celle de bodySizeLimit Next (10 MB) pour matcher.
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Libellé humain des formats autorisés, réutilisé dans les messages.
export const ALLOWED_LABEL = 'PDF, JPG, PNG, GIF, WEBP, HEIC, CSV, XLS(X)';

// Valeur d'attribut `accept` cohérente avec la whitelist (hint du
// sélecteur de fichiers ; ne remplace pas la validation).
export const ALLOWED_ACCEPT =
  'image/*,application/pdf,.csv,.xls,.xlsx,.heic,.heif';

export function extOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

// Validation côté client (avant submit). Retourne un message d'erreur
// utilisateur, ou `null` si le fichier est accepté. Même logique que
// `validateJustifAttachment` côté serveur — qui reste l'autorité.
export function validateClientFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = Math.round((file.size / 1024 / 1024) * 10) / 10;
    return `${file.name} : fichier trop volumineux (${sizeMb} MB). Limite : 10 MB.`;
  }
  const ext = extOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `${file.name} : type non autorisé (.${ext || 'sans extension'}). Autorisés : ${ALLOWED_LABEL}.`;
  }
  // Le navigateur ne renseigne pas toujours le MIME (drag&drop, certains
  // OS) : on ne rejette sur le MIME que s'il est présent ET inconnu.
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return `${file.name} : type MIME non autorisé (${file.type}).`;
  }
  return null;
}
