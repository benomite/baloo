import { z } from 'zod';
import { updateCarte } from '@/lib/services/cartes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  porteur: z.string().min(1).optional(),
  comptaweb_id: z.number().int().nullish(),
  code_externe: z.string().nullish(),
  statut: z.enum(['active', 'ancienne']).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateCarte({ groupId }, id, parsed.data);
  if (!updated) return jsonError('Carte introuvable.', 404);
  return Response.json(updated);
}
