import { consumeAuthorizationCode, AuthorizationCodeError } from '@/lib/services/oauth-codes';
import { issueAccessToken } from '@/lib/services/oauth-access-tokens';

export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    const text = await request.text();
    form = new URLSearchParams(text);
  } catch {
    return errorResponse('invalid_request', 'Body invalide.', 400);
  }

  const grant_type = form.get('grant_type');
  const code = form.get('code');
  const redirect_uri = form.get('redirect_uri');
  const client_id = form.get('client_id');
  const code_verifier = form.get('code_verifier');

  if (grant_type !== 'authorization_code') {
    return errorResponse('unsupported_grant_type', 'Seul authorization_code est supporté.', 400);
  }
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return errorResponse('invalid_request', 'Paramètres manquants.', 400);
  }

  try {
    const { user_id, scope } = await consumeAuthorizationCode({
      code,
      client_id,
      redirect_uri,
      code_verifier,
    });
    const issued = await issueAccessToken({ client_id, user_id, scope });
    const expiresIn = Math.floor(
      (new Date(issued.expires_at).getTime() - Date.now()) / 1000,
    );
    return Response.json(
      {
        access_token: issued.plain,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (err) {
    if (err instanceof AuthorizationCodeError) {
      return errorResponse(err.reason, undefined, 400);
    }
    throw err;
  }
}

function errorResponse(error: string, description: string | undefined, status: number): Response {
  return Response.json(
    description ? { error, error_description: description } : { error },
    { status },
  );
}
