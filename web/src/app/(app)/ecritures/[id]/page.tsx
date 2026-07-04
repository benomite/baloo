import { redirect } from 'next/navigation';

// La vue détail dédiée a été supprimée : le panneau (inline dans la liste,
// ou épinglé en haut via ?open) est désormais l'unique rendu du détail d'une
// écriture. Cette route ne fait que rediriger vers la liste avec la bonne
// ligne ouverte, pour que tous les liens entrants (remboursements, camps,
// cmd-clic, redirections serveur) continuent d'aboutir.
export default async function EcritureDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/ecritures?open=${encodeURIComponent(id)}`);
}
