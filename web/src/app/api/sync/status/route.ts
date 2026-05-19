// GET /api/sync/status — état de la sync incrémentale Comptaweb pour le
// groupe courant. Accès ADMIN_ROLES (tresorier / RG).
//
// Réponse : SyncStatus (cf. lib/services/sync-cycle.ts).
//   { group_id, last_run, is_running, stale, throttle_until }

import { jsonError, requireApiContext } from '@/lib/api/route-helpers';
import { ADMIN_ROLES } from '@/lib/auth/access';
import { getDb } from '@/lib/db';
import { getSyncStatus } from '@/lib/services/sync-cycle';

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  if (!ADMIN_ROLES.includes(ctxR.ctx.role as 'tresorier' | 'RG')) {
    return jsonError('Accès réservé aux trésoriers / RG.', 403);
  }

  const status = await getSyncStatus(getDb(), ctxR.ctx.groupId);
  return Response.json(status);
}
