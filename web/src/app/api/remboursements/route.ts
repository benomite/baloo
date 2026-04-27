import { z } from 'zod';
import {
  listRemboursements,
  createRemboursement,
  type RemboursementFilters,
} from '@/lib/services/remboursements';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    status: z.enum(['demande', 'valide', 'paye', 'refuse']).optional(),
    unite_id: z.string().optional(),
    demandeur: z.string().optional(),
    search: z.string().optional(),
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
  return Response.json(await listRemboursements({ groupId, scopeUniteId }, parsed.data as RemboursementFilters));
}

const createSchema = z.object({
  demandeur: z.string().min(1),
  amount_cents: z.number().int(),
  date_depense: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nature: z.string().min(1),
  unite_id: z.string().nullish(),
  justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
  mode_paiement_id: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const created = await createRemboursement({ groupId, scopeUniteId }, parsed.data);
  return Response.json(created, { status: 201 });
}
