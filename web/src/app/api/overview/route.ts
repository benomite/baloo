import { getOverview } from '@/lib/services/overview';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function GET() {
  const { groupId } = requireApiContext();
  return Response.json(getOverview({ groupId }));
}
