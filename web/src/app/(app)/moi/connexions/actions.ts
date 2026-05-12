'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { revokeTokenByHash } from '@/lib/services/oauth-access-tokens';

export async function revokeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const tokenHash = formData.get('token_hash');
  if (typeof tokenHash !== 'string' || !tokenHash) return;
  await revokeTokenByHash(session.user.id, tokenHash);
  revalidatePath('/moi/connexions');
}
