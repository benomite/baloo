import { headers } from 'next/headers';

// Resolution de l'URL canonique de l'instance baloo, pour les endpoints
// OAuth (issuer, metadata, etc.).
//
// Strategie : on prefere lire le header Host de la request (set par Vercel
// avec la bonne valeur, et par le browser en dev local). Si on n'a pas la
// request, on tombe back sur AUTH_URL/NEXTAUTH_URL, puis localhost en
// dernier recours.
//
// Le projet utilise AUTH_TRUST_HOST=true cote NextAuth ; meme contrat ici.

export function issuerUrlFromRequest(request: Request): string {
  const host = request.headers.get('host');
  if (!host) return fallbackIssuer();
  const proto =
    request.headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function issuerUrlFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get('host');
  if (!host) return fallbackIssuer();
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function fallbackIssuer(): string {
  return process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}
