// Helpers communs aux route handlers `web/src/app/api/*` (chantier 2,
// doc/p2-pivot-webapp.md). Centralise la résolution du contexte courant et
// le format de réponse d'erreur.
//
// Au chantier 4, `requireApiContext` lira la session auth au lieu de
// `getCurrentContext()` (qui résout le user via BALOO_USER_EMAIL).

import { ZodError, type ZodType } from 'zod';
import { getCurrentContext } from '../context';

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

export function requireApiContext(): ApiContext {
  return getCurrentContext();
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
