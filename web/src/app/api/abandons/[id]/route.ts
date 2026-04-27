import { z } from 'zod';
import { updateAbandon } from '@/lib/services/abandons';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  cerfa_emis: z.boolean().optional(),
  notes: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = await updateAbandon({ groupId, scopeUniteId }, id, parsed.data);
  if (!updated) return jsonError('Abandon introuvable.', 404);
  return Response.json(updated);
}
