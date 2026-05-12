import { applyAutoLinks } from '@/lib/services/inbox-auto';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const result = await applyAutoLinks(groupId);
  return Response.json({
    linked: result.pairs,
    rejected_ambiguous: [],
  });
}
