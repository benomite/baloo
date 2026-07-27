// Garde pure A3 : on ne peut lier une demande à une écriture comptable
// qu'une fois le virement effectué (avant, l'écriture n'existe pas). On
// autorise aussi `termine` pour re-lier / consulter (le passage en termine
// vient justement du lien — cf. A4).
export function canLinkEcriture(status: string): boolean {
  return status === 'virement_effectue' || status === 'termine';
}
