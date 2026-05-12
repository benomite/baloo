import { z } from 'zod';
import { attachDepotToEcriture } from '@/lib/services/depots';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z
  .object({
    ecriture_id: z.string().min(1),
    depot_id: z.string().min(1),
  })
  .strict();

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  try {
    const depot = await attachDepotToEcriture(
      { groupId },
      parsed.data.depot_id,
      parsed.data.ecriture_id,
    );
    return Response.json({ ok: true, depot }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue.';
    return jsonError(msg, 400);
  }
}
