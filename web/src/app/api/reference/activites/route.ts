import { listActivites } from '@/lib/services/reference';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function GET() {
  const { groupId } = requireApiContext();
  return Response.json(listActivites({ groupId }));
}
