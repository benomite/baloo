import { z } from 'zod';
import { recherche } from '@/lib/services/recherche';
import { parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z.object({
  query: z.string().min(1),
  tables: z
    .array(z.enum(['ecritures', 'remboursements', 'abandons', 'caisse', 'cheques']))
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// POST plutôt que GET car on accepte un tableau dans `tables` (et la query
// peut contenir des caractères qui rendent l'URL pénible).
export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(recherche({ groupId }, parsed.data));
}
