import { z } from 'zod';
import {
  listMouvementsCaisse,
  createMouvementCaisse,
} from '@/lib/services/caisse';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const { groupId } = requireApiContext();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listMouvementsCaisse({ groupId }, parsed.data));
}

const createSchema = z.object({
  date_mouvement: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount_cents: z.number().int(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const { groupId } = requireApiContext();
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const created = createMouvementCaisse({ groupId }, parsed.data);
  return Response.json(created, { status: 201 });
}
