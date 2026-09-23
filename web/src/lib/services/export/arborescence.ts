// Noms de dossiers et de fichiers de l'archive. Module pur : aucun accès au
// système de fichiers, juste la construction des noms.
//
// L'archive atterrit dans un Drive puis, potentiellement, sur Windows et
// macOS : on translittère les accents, on neutralise tout ce qui est interdit
// quelque part, et on borne la longueur.

const MAX_SEGMENT = 60;

export function slug(texte: string, maxLen: number = MAX_SEGMENT): string {
  const base = texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (base.length === 0) return 'sans-titre';
  if (base.length <= maxLen) return base;
  // Tronquer au dernier séparateur pour ne pas couper un mot en deux.
  const coupe = base.slice(0, maxLen);
  const dernier = coupe.lastIndexOf('-');
  return (dernier > 0 ? coupe.slice(0, dernier) : coupe).replace(/-$/, '');
}

export function dossierEcriture(e: {
  id: string;
  date_ecriture: string | null;
  numero_piece: string | null;
  description: string | null;
}): string {
  const date = e.date_ecriture ?? 'sans-date';
  const piece = e.numero_piece ?? e.id;
  return `${date}-${piece}-${slug(e.description ?? '')}`;
}

export function dossierRemboursement(r: { id: string; demandeur: string | null }): string {
  return `${r.id}-${slug(r.demandeur ?? '')}`;
}
