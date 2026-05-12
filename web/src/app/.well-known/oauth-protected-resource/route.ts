function getIssuerUrl(): string {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

export async function GET() {
  const issuer = getIssuerUrl();
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
