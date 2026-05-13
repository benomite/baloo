import { issuerUrlFromRequest } from '@/lib/oauth/issuer';

export async function GET(request: Request) {
  const issuer = issuerUrlFromRequest(request);
  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: ['treso'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    },
  );
}
