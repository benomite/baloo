import { z } from 'zod';
import { listCartes, createCarte } from '@/lib/services/cartes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    statut: z.enum(['active', 'ancienne']).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listCartes({ groupId }, parsed.data));
}

const createSchema = z.object({
  type: z.enum(['cb', 'procurement']),
  porteur: z.string().min(1),
  comptaweb_id: z.number().int().nullish(),
  code_externe: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const created = createCarte({ groupId }, parsed.data);
  return Response.json(created, { status: 201 });
}
