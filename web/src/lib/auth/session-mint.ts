import { randomUUID } from 'crypto';
import type { DbWrapper } from '../db';

// Forge une session Auth.js (stratégie "database") sans passer par le flux
// magic link. Utilisé par la route /i/[token] (lien d'auto-connexion).
//
// Auth.js lit la session via le cookie `authjs.session-token` (préfixe
// `__Secure-` en https) puis `getSessionAndUser(token)` sur l'adapter, qui
// JOIN sessions ⋈ users. Donc : insérer une ligne sessions + poser le cookie
// avec la même valeur de token suffit à connecter l'utilisateur.

// 30 jours = maxAge par défaut des sessions database d'Auth.js.
const SESSION_TTL_DAYS = 30;

export interface MintedSession {
  sessionToken: string;
  expires: Date;
}

export async function createDbSession(db: DbWrapper, userId: string): Promise<MintedSession> {
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .prepare('INSERT INTO sessions (session_token, user_id, expires) VALUES (?, ?, ?)')
    .run(sessionToken, userId, expires.toISOString());
  return { sessionToken, expires };
}

export interface SessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'lax';
    path: '/';
    secure: boolean;
    expires: Date;
  };
}

export function buildSessionCookie(
  token: string,
  expires: Date,
  secure: boolean,
): SessionCookie {
  const name = secure ? '__Secure-authjs.session-token' : 'authjs.session-token';
  return {
    name,
    value: token,
    options: { httpOnly: true, sameSite: 'lax', path: '/', secure, expires },
  };
}
