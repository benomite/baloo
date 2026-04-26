import { z } from 'zod';
import { listDepotsCheques, createDepotCheques } from '@/lib/services/cheques';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    type_depot: z.enum(['banque', 'ancv']).optional(),
    confirmation_status: z.enum(['en_attente', 'confirme']).optional(),
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
  return Response.json(listDepotsCheques({ groupId }, parsed.data));
}

const createSchema = z.object({
  date_depot: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type_depot: z.enum(['banque', 'ancv']),
  cheques: z
    .array(
      z.object({
        emetteur: z.string().min(1),
        amount_cents: z.number().int(),
        numero: z.string().nullish(),
      }),
    )
    .min(1),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(createDepotCheques({ groupId }, parsed.data), { status: 201 });
}
