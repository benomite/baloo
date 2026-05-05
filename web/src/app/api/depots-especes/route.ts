import { z } from 'zod';
import {
  listDepotsEspeces,
  attachDepotEspecesToEcriture,
} from '@/lib/services/depots-especes';
import { createDepotEspecesAvecMouvement } from '@/lib/services/caisse';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    pending_only: z
      .union([z.literal('true'), z.literal('false'), z.boolean()])
      .optional()
      .transform((v) => v === true || v === 'true'),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(await listDepotsEspeces({ groupId }, parsed.data));
}

const createSchema = z.object({
  date_depot: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_amount_cents: z.number().int().positive(),
  description: z.string().nullish(),
  detail_billets: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const result = await createDepotEspecesAvecMouvement({ groupId }, parsed.data);
  return Response.json(result, { status: 201 });
}

const attachSchema = z.object({
  depot_id: z.string().min(1),
  ecriture_id: z.string().min(1),
});

export async function PATCH(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, attachSchema);
  if ('error' in parsed) return parsed.error;
  const updated = await attachDepotEspecesToEcriture(
    { groupId },
    parsed.data.depot_id,
    parsed.data.ecriture_id,
  );
  return Response.json(updated);
}
