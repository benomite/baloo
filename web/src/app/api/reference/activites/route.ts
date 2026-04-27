import { listActivites } from '@/lib/services/reference';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  return Response.json(await listActivites({ groupId }));
}
