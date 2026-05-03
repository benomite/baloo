'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { WELCOME_COOKIE } from '../onboarding-cookie';

// Server action : appelée par le bouton X du WelcomeBanner pour
// masquer le bandeau définitivement (cookie 1 an). Le helper de
// LECTURE du cookie vit dans `lib/onboarding-cookie.ts` (sans
// `'use server'`) — sinon Next 16 traite chaque export comme une
// server action serialisable et la lecture depuis un server component
// plante en prod.
export async function dismissWelcomeBanner(): Promise<void> {
  const c = await cookies();
  c.set({
    name: WELCOME_COOKIE,
    value: '1',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 an
    sameSite: 'lax',
    httpOnly: false,
  });
  revalidatePath('/');
}
