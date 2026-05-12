import { z } from 'zod';
import { findSuggestionsForEcriture, findSuggestionsForDepot } from '@/lib/queries/inbox';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const querySchema = z
  .object({
    ecriture_id: z.string().optional(),
    depot_id: z.string().optional(),
  })
  .strict()
  .refine(
    (v) => (!!v.ecriture_id) !== (!!v.depot_id),
    { message: 'Fournir exactement un de ecriture_id ou depot_id.' },
  );

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  if (parsed.data.ecriture_id) {
    const matches = await findSuggestionsForEcriture({ groupId }, parsed.data.ecriture_id);
    return Response.json({ ecriture_id: parsed.data.ecriture_id, matches });
  }
  const matches = await findSuggestionsForDepot({ groupId }, parsed.data.depot_id!);
  return Response.json({ depot_id: parsed.data.depot_id, matches });
}
