// Helpers communs aux route handlers `web/src/app/api/*` (chantier 2,
// doc/p2-pivot-webapp.md). Centralise la résolution du contexte courant et
// le format de réponse d'erreur.
//
// Auth (chantier 4, ADR-014) :
// - Si la requête porte un `Authorization: Bearer <token>`, le token est
//   vérifié contre `api_tokens` → contexte = user+group du token.
// - Sinon, on utilise la session Auth.js (cookie) → contexte = user+group
//   du user de session.
// - Sinon, 401.
//
// Important : `requireApiContext` peut renvoyer une `Response` 401 que le
// route handler doit retourner directement. C'est le pattern Next.js
// idiomatique pour cette version (pas de middleware edge à cause de
// better-sqlite3 qui ne tourne qu'en runtime Node).

import { ZodError, type ZodType } from 'zod';
import { auth } from '../auth/auth';
import { verifyApiToken } from '../auth/api-tokens';
import { getDb } from '../db';

export interface ApiContext {
  userId: string;
  groupId: string;
}

export interface ApiError {
  error: string;
  fields?: Record<string, string[]>;
}

export function jsonError(error: string, status: number, fields?: Record<string, string[]>): Response {
  const body: ApiError = fields ? { error, fields } : { error };
  return Response.json(body, { status });
}

export type RequireApiContextResult =
  | { ctx: ApiContext }
  | { error: Response };

export async function requireApiContext(request: Request): Promise<RequireApiContextResult> {
  // 1. Bearer token
  const authz = request.headers.get('authorization');
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice(7).trim();
    const ctx = verifyApiToken(token);
    if (ctx) return { ctx };
    return { error: jsonError('Token invalide ou expiré.', 401) };
  }

  // 2. Session cookie via Auth.js
  const session = await auth();
  if (!session?.user?.id) {
    return { error: jsonError('Authentification requise.', 401) };
  }

  // Le user `id` côté session vient de notre adapter (table `users`). On
  // récupère le `group_id` correspondant.
  const row = getDb()
    .prepare("SELECT group_id FROM users WHERE id = ? AND statut = 'actif'")
    .get(session.user.id) as { group_id: string } | undefined;
  if (!row) return { error: jsonError('User inactif ou inconnu.', 401) };

  return { ctx: { userId: session.user.id, groupId: row.group_id } };
}

// Parse + valide un body JSON contre un schéma Zod. Retourne soit `{ data }`
// soit `{ error: Response }` à renvoyer tel quel par le route handler.
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: jsonError('Body JSON invalide.', 400) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return { error: jsonError('Validation échouée.', 400, zodFieldErrors(result.error)) };
  }
  return { data: result.data };
}

function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = [];
    fields[key].push(issue.message);
  }
  return fields;
}
