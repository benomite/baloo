'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

const WELCOME_COOKIE = 'baloo_welcome_dismissed';

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

export async function isWelcomeBannerDismissed(): Promise<boolean> {
  const c = await cookies();
  return c.get(WELCOME_COOKIE)?.value === '1';
}
