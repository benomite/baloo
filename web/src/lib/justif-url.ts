// Adresse d'un justificatif dans l'app (`GET /api/justificatifs/...`) et
// chemin encodé pour le store Blob. Le nom de fichier d'origine fait partie
// du `file_path` : un `#`, un `?` ou un `%` y coupe ou déforme l'adresse
// s'il n'est pas encodé (ticket #42). `encodeURIComponent` par segment
// laisse les `/` séparateurs et ne change rien aux noms ordinaires.
export function encodeJustifPath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

export function justifUrl(filePath: string): string {
  return `/api/justificatifs/${encodeJustifPath(filePath)}`;
}
