import { getOverview } from '@/lib/services/overview';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  return Response.json(await getOverview({ groupId }));
}
