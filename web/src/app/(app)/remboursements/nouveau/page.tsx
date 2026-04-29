import { redirect } from 'next/navigation';

// L'ancien form admin mono-ligne a été remplacé par le form multi-lignes
// `/moi/remboursements/nouveau` (chantier 2-bis, ADR-022). Le trésorier
// qui saisit pour un bénévole utilise le même form en éditant
// prenom/nom/email — un seul flux pour tous les cas.
export default function RedirectToNewForm() {
  redirect('/moi/remboursements/nouveau');
}
