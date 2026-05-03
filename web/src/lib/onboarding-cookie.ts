import { cookies } from 'next/headers';

// Helpers cookie d'onboarding (lecture). PAS dans un fichier
// `'use server'` : ce sont des fonctions de lecture appelées depuis
// les server components, pas des server actions exposées au client.
//
// La server action de SET vit dans `lib/actions/onboarding.ts`.

export const WELCOME_COOKIE = 'baloo_welcome_dismissed';

export async function isWelcomeBannerDismissed(): Promise<boolean> {
  const c = await cookies();
  return c.get(WELCOME_COOKIE)?.value === '1';
}
