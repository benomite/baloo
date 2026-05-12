import { ensureBusinessSchema } from '@/lib/db/business-schema';
import { revokeAccessToken } from '@/lib/services/oauth-access-tokens';

export async function POST(request: Request) {
  await ensureBusinessSchema();
  let form: URLSearchParams;
  try {
    const text = await request.text();
    form = new URLSearchParams(text);
  } catch {
    return new Response(null, { status: 200 });
  }

  const token = form.get('token');
  if (!token) {
    // RFC 7009 : 200 même si pas de token (pas de leak d'info).
    return new Response(null, { status: 200 });
  }

  await revokeAccessToken(token);
  return new Response(null, { status: 200 });
}
