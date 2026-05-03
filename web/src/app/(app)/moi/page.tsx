import { redirect } from 'next/navigation';

// /moi a été fusionné dans la home (/) pour éviter la redondance.
// Cette page conserve l'URL pour ne pas casser les liens existants
// (notifications email, anciens redirects de server actions, etc.).
// Elle relaie tous les query params vers / pour préserver les flash
// messages (?rbt_created, ?abandon_created, ?error...).
export default async function MoiRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v !== undefined) params.set(k, v);
  }
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : '/');
}
