// POST /api/sync/run — déclenche un cycle de sync incrémentale Comptaweb
// pour le groupe courant. Accès ADMIN_ROLES (tresorier / RG) uniquement.
//
// Query :
//   ?force=1  → override le throttle 15 min (mais pas le verrou running).
//
// Réponses :
//   202 Accepted  → sync run OK (corps = SyncCycleResult)
//   429 Too Many  → throttled OU already_running (corps = SyncCycleResult)
//   500           → échec scraper ou autre (corps = SyncCycleResult)
//   401/403       → auth/role
//
// Cf. doc/specs/2026-05-19-baloo-sync-incremental-design.md.

import { jsonError, requireApiContext } from '@/lib/api/route-helpers';
import { ADMIN_ROLES } from '@/lib/auth/access';
import { getDb } from '@/lib/db';
import { runSyncCycle } from '@/lib/services/sync-cycle';

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  if (!ADMIN_ROLES.includes(ctxR.ctx.role as 'tresorier' | 'RG')) {
    return jsonError('Accès réservé aux trésoriers / RG.', 403);
  }

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  const result = await runSyncCycle(getDb(), ctxR.ctx.groupId, {
    trigger: 'client',
    force,
  });

  if (result.status === 'skipped') {
    return Response.json(result, { status: 429 });
  }
  if (result.status === 'failed') {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result, { status: 202 });
}
