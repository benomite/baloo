import { listInboxItems } from '@/lib/queries/inbox';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  // On utilise period='tout' parce que les justifs orphelins n'ont pas
  // de filtre période dans la webapp (cf. spec).
  const data = await listInboxItems({ groupId, period: 'tout', includeRecettes: true });

  return Response.json({
    count: data.justifsOrphelins.length,
    depots: data.justifsOrphelins,
  });
}
