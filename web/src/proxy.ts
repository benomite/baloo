import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAMES } from '@/lib/auth/session-mint';

// Home publique (#21). Un visiteur sans cookie de session qui arrive sur `/`
// voit la présentation de Baloo (`/about`, réécrite : l'URL reste `/`) au
// lieu d'être renvoyé direct sur `/login`. Avec un cookie, on laisse passer :
// le dashboard et son layout `(app)` vérifient la vraie session (un cookie
// expiré y est renvoyé sur `/login`, comme avant).
//
// Check « optimiste » sur la seule présence du cookie : pas de lecture BDD
// ici (cf. doc Next, Proxy ≠ gestion de session).

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();
  return NextResponse.rewrite(new URL('/about', request.url));
}

export const config = {
  matcher: '/',
};
