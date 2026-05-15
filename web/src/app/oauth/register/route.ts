import { z } from 'zod';
import { ensureBusinessSchema } from '@/lib/db/business-schema';
import { registerClient } from '@/lib/services/oauth-clients';
import { logError } from '@/lib/log';

// RFC 7591 : on doit etre tolerant sur les metadata recus. On valide
// strictement ce dont on a besoin (client_name, redirect_uris). Pour le
// reste (grant_types, response_types, scope, etc.), on accepte tout
// puis on impose nos propres valeurs dans la reponse (les seules qu'on
// supporte vraiment : authorization_code + S256 + auth method 'none').
const registerSchema = z
  .object({
    client_name: z.string().min(1).max(100),
    redirect_uris: z
      .array(
        z.string().refine(
          (uri) => {
            // Schemes interdits (XSS / data leak)
            if (/^(javascript|data|file|vbscript):/i.test(uri)) return false;
            // URL standard ou scheme custom (claude://, etc.)
            try {
              new URL(uri);
              return true;
            } catch {
              return /^[a-z][a-z0-9+\-.]*:\/\//i.test(uri);
            }
          },
          { message: 'redirect_uri schema invalide ou interdit' },
        ),
      )
      .min(1),
  })
  .passthrough();

export async function POST(request: Request) {
  await ensureBusinessSchema();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  logError('oauth/register', 'DCR request received', null, {
    client_name: parsed.data.client_name,
    redirect_uris: parsed.data.redirect_uris,
    raw_body_keys: Object.keys(payload as Record<string, unknown>),
  });

  const client = await registerClient({
    client_name: parsed.data.client_name,
    redirect_uris: parsed.data.redirect_uris,
  });

  return Response.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 },
  );
}
