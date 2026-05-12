import { z } from 'zod';
import { findInternalTransfers, deleteInternalTransfers } from '@/lib/services/cleanup-transferts';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z
  .object({
    mode: z.enum(['preview', 'apply']),
    ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.mode === 'preview') {
    const report = await findInternalTransfers({ groupId });
    return Response.json({ mode: 'preview', ...report });
  }

  if (!parsed.data.ids || parsed.data.ids.length === 0) {
    return jsonError(
      "mode=apply exige une liste ids non vide (issue d'un preview).",
      400,
    );
  }

  const result = await deleteInternalTransfers({ groupId }, parsed.data.ids);
  return Response.json({ mode: 'apply', requested: parsed.data.ids.length, ...result });
}
