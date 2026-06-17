import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureAuthSchema } from '@/lib/auth/schema';
import { resolveInviteLink, markUserConnected } from '@/lib/auth/invite-links';
import { createDbSession, buildSessionCookie } from '@/lib/auth/session-mint';
import { logError } from '@/lib/log';

// Route publique (hors groupe (app), pas de session requise pour l'atteindre).
// Lien d'auto-connexion : résout le token, forge une session Auth.js et
// redirige vers le formulaire de remboursement.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const origin = req.nextUrl.origin;

  try {
    await ensureAuthSchema();
    const db = getDb();

    const resolved = await resolveInviteLink(db, token);
    if (!resolved) {
      return NextResponse.redirect(new URL('/login?error=InviteExpired', origin));
    }

    const { sessionToken, expires } = await createDbSession(db, resolved.userId);
    await markUserConnected(db, resolved.userId);

    const secure = req.nextUrl.protocol === 'https:';
    const cookie = buildSessionCookie(sessionToken, expires, secure);

    const res = NextResponse.redirect(new URL(resolved.callbackUrl, origin));
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (err) {
    logError('invite-link', "Échec ouverture du lien d'auto-connexion", err, { });
    return NextResponse.redirect(new URL('/login?error=InviteError', origin));
  }
}
