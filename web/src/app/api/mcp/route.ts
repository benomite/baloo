import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ensureBusinessSchema } from '@/lib/db/business-schema';
import { verifyOauthAccessToken } from '@/lib/mcp/auth';
import { registerAllTools } from '@/lib/mcp/register-all';
import { issuerUrlFromRequest } from '@/lib/oauth/issuer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function unauthorized(request: Request): Response {
  const issuer = issuerUrlFromRequest(request);
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
    },
  });
}

async function handle(request: Request): Promise<Response> {
  await ensureBusinessSchema();

  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return unauthorized(request);

  const ctx = await verifyOauthAccessToken(auth.slice(7).trim());
  if (!ctx) return unauthorized(request);
  if (ctx.scope !== 'treso') return unauthorized(request);

  const server = new McpServer({ name: 'baloo', version: '1.0.0' });
  registerAllTools(server, ctx);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}
