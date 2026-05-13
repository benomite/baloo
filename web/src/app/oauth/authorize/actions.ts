'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { issueAuthorizationCode } from '@/lib/services/oauth-codes';
import { findClientByClientId, touchLastUsed, validateRedirectUri } from '@/lib/services/oauth-clients';
import { logError } from '@/lib/log';

export async function authorizeAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const client_id = formData.get('client_id') as string;
  const redirect_uri = formData.get('redirect_uri') as string;
  const scope = formData.get('scope') as string;
  const state = formData.get('state') as string;
  const code_challenge = formData.get('code_challenge') as string;
  const code_challenge_method = formData.get('code_challenge_method') as string;

  logError('oauth/authorize', 'authorize action invoked', null, {
    user_id: session.user.id,
    client_id,
    redirect_uri,
    scope,
    has_state: Boolean(state),
    code_challenge_method,
  });

  // Re-validation defensive (cas POST direct sur l'action).
  if (!client_id || !redirect_uri || !code_challenge || code_challenge_method !== 'S256' || scope !== 'treso') {
    redirect('/login');
  }
  const client = await findClientByClientId(client_id);
  if (!client) redirect('/login');
  if (!validateRedirectUri(client, redirect_uri)) redirect('/login');

  const code = await issueAuthorizationCode({
    client_id,
    user_id: session.user.id,
    scope,
    code_challenge,
    code_challenge_method,
    redirect_uri,
  });
  await touchLastUsed(client_id);

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  redirect(url.toString());
}

export async function denyAction(formData: FormData): Promise<void> {
  const redirect_uri = formData.get('redirect_uri') as string;
  const state = formData.get('state') as string;
  const url = new URL(redirect_uri);
  url.searchParams.set('error', 'access_denied');
  if (state) url.searchParams.set('state', state);
  redirect(url.toString());
}
