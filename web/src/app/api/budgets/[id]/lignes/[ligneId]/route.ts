import { z } from 'zod';
import {
  updateBudgetLigne,
  deleteBudgetLigne,
} from '@/lib/services/budgets';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  libelle: z.string().min(1).optional(),
  type: z.enum(['depense', 'recette']).optional(),
  amount_cents: z.number().int().optional(),
  unite_id: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  activite_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; ligneId: string }> },
) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { ligneId } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = await updateBudgetLigne({ groupId: ctxR.ctx.groupId }, ligneId, parsed.data);
  if (!updated) return jsonError('Ligne introuvable', 404);
  return Response.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; ligneId: string }> },
) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { ligneId } = await params;
  const ok = await deleteBudgetLigne({ groupId: ctxR.ctx.groupId }, ligneId);
  if (!ok) return jsonError('Ligne introuvable', 404);
  return new Response(null, { status: 204 });
}
