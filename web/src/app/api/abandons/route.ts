import { z } from 'zod';
import { listAbandons, createAbandon } from '@/lib/services/abandons';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    annee_fiscale: z.string().optional(),
    donateur: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listAbandons({ groupId, scopeUniteId }, parsed.data));
}

const createSchema = z.object({
  donateur: z.string().min(1),
  amount_cents: z.number().int(),
  date_depense: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nature: z.string().min(1),
  unite_id: z.string().nullish(),
  annee_fiscale: z.string().min(1),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(createAbandon({ groupId, scopeUniteId }, parsed.data), { status: 201 });
}
