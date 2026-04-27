import { z } from 'zod';
import { batchUpdateEcritures } from '@/lib/services/ecritures';
import { parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const batchSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    unite_id: z.string().nullish(),
    category_id: z.string().nullish(),
    activite_id: z.string().nullish(),
    mode_paiement_id: z.string().nullish(),
    carte_id: z.string().nullish(),
    justif_attendu: z.union([z.literal(0), z.literal(1)]).optional(),
    description_prefix: z.string().optional(),
  }),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, batchSchema);
  if ('error' in parsed) return parsed.error;
  const result = batchUpdateEcritures({ groupId, scopeUniteId }, parsed.data.ids, parsed.data.patch);
  return Response.json(result);
}
