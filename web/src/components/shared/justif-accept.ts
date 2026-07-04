// Filtre les fichiers déposés (drag & drop) sur un bloc justificatif.
// On n'accepte que ce que l'input file accepte déjà : image/* + PDF.
//
// Certains OS/navigateurs livrent un `File` au type MIME vide lors d'un
// glisser (notamment PDF/HEIC depuis le Finder). On retombe alors sur
// l'extension pour ne pas rejeter à tort un fichier légitime.

const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif',
]);

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isAccepted(f: File): boolean {
  const type = f.type.toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type === 'application/pdf') return true;
  // Type MIME absent → on se rabat sur l'extension.
  if (type === '') {
    const ext = extOf(f.name);
    return ext === 'pdf' || IMAGE_EXT.has(ext);
  }
  return false;
}

export function acceptJustifFiles(files: File[]): File[] {
  return files.filter(isAccepted);
}
