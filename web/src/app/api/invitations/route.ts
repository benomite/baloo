import { z } from 'zod';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';
import { ADMIN_ROLES } from '@/lib/auth/access';
import {
  createInvitation,
  listPendingInvitations,
} from '@/lib/services/invitations';

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(['tresorier', 'RG', 'chef', 'equipier', 'parent']),
  scope_unite_id: z.string().nullish(),
  nom_affichage: z.string().nullish(),
});

function getAppUrl(request: Request): string {
  const explicit = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;
  // Fallback : déduit depuis la requête (Vercel set le bon host derrière proxy).
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  if (!ADMIN_ROLES.includes(ctxR.ctx.role as 'tresorier' | 'RG')) {
    return jsonError('Accès réservé aux trésoriers / RG.', 403);
  }
  return Response.json(await listPendingInvitations({ groupId: ctxR.ctx.groupId }));
}

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  if (!ADMIN_ROLES.includes(ctxR.ctx.role as 'tresorier' | 'RG')) {
    return jsonError('Accès réservé aux trésoriers / RG.', 403);
  }

  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;

  try {
    const result = await createInvitation(
      { groupId: ctxR.ctx.groupId, inviterUserId: ctxR.ctx.userId },
      { ...parsed.data, app_url: getAppUrl(request) },
    );
    return Response.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 400);
  }
}
