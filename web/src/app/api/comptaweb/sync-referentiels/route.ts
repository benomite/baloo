import { syncReferentielsFromComptaweb } from '@/lib/actions/referentiels';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const result = await syncReferentielsFromComptaweb();
  if (!result.ok) return jsonError(result.erreur ?? 'Sync échouée.', 502);
  return Response.json(result);
}
