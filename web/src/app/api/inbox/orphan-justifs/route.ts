import { z } from 'zod';
import { listInboxItems } from '@/lib/queries/inbox';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const querySchema = z.object({}).strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  // Les justifs orphelins n'ont pas de filtre période (cf. spec) :
  // période='tout' et inclusion des recettes pour ramener tous les
  // dépôts en statut a_traiter.
  const data = await listInboxItems({ period: 'tout', includeRecettes: true, groupId });

  return Response.json({
    count: data.justifsOrphelins.length,
    depots: data.justifsOrphelins,
  });
}
