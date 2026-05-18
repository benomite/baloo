import { z } from 'zod';
import { listOrphanPendingEcritures } from '@/lib/queries/inbox';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';
import { pendingStatuses } from '@/lib/services/ecritures-status';

// Inbox des écritures pending — pivot Phase 1 "miroir strict + MCP-first".
//
// Liste les écritures qui ne sont pas (encore) dans le miroir CW :
// status IN ('draft', 'pending_cw', 'pending_sync'). Sert au futur
// dashboard "ce qu'il reste à faire" + au MCP (tools / agents).
//
// Ne JAMAIS exposer mirror/divergent depuis cet endpoint — ils sortent
// via GET /api/ecritures (avec `?includeDivergent=1` pour les divergent).

const PENDING_STATUSES = pendingStatuses();

const querySchema = z
  .object({
    // Restriction optionnelle à un seul statut (audit). Sans, on
    // renvoie les 3 (draft + pending_cw + pending_sync).
    status: z.enum(PENDING_STATUSES as unknown as [string, ...string[]]).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const data = await listOrphanPendingEcritures({
    groupId,
    status: parsed.data.status as Parameters<typeof listOrphanPendingEcritures>[0]['status'],
    limit: parsed.data.limit,
  });

  return Response.json({
    count: data.length,
    ecritures: data,
  });
}
