import { scanDraftsFromComptaweb } from '@/lib/services/drafts';
import { requireApiContext } from '@/lib/api/route-helpers';

export async function POST() {
  const { groupId } = requireApiContext();
  return Response.json(await scanDraftsFromComptaweb({ groupId }));
}
