import { issuerUrlFromRequest } from '@/lib/oauth/issuer';

export async function GET(request: Request) {
  const issuer = issuerUrlFromRequest(request);
  return Response.json(
    {
      resource: `${issuer}/api/mcp`,
      authorization_servers: [issuer],
      scopes_supported: ['treso'],
      bearer_methods_supported: ['header'],
    },
    {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    },
  );
}
