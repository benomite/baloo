import { scanDraftsFromComptaweb } from '@/lib/services/drafts';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  return Response.json(await scanDraftsFromComptaweb({ groupId }));
}
