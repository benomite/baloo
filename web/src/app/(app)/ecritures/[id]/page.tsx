import { redirect } from 'next/navigation';

// La vue détail dédiée a été supprimée : le panneau (inline dans la liste,
// ou épinglé en haut via ?open) est désormais l'unique rendu du détail d'une
// écriture. Cette route ne fait que rediriger vers la liste avec la bonne
// ligne ouverte, pour que tous les liens entrants (remboursements, camps,
// cmd-clic, redirections serveur) continuent d'aboutir.
//
// La query string est REPORTÉE : plusieurs actions serveur signalent leur
// échec par `redirect('/ecritures/<id>?error=…')` (rattachement d'un dépôt,
// partage de justif…). Sans report, l'erreur est perdue en route et succès
// et échec atterrissent au même endroit, muets — cas terrain 2026-09-09
// (dépôt « Voiture de location » réputé rattaché, resté dans la file).
export default async function EcritureDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams ?? Promise.resolve({})]);
  const qs = new URLSearchParams({ open: id });
  for (const [key, value] of Object.entries(sp)) {
    if (key === 'open' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  redirect(`/ecritures?${qs.toString()}`);
}
