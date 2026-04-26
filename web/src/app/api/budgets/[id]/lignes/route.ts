import { z } from 'zod';
import { listBudgetLignes, createBudgetLigne } from '@/lib/services/budgets';
import { parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { id } = await params;
  return Response.json(listBudgetLignes(id));
}

const createSchema = z.object({
  libelle: z.string().min(1),
  type: z.enum(['depense', 'recette']),
  amount_cents: z.number().int(),
  unite_id: z.string().nullish(),
  category_id: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { id } = await params;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const created = createBudgetLigne({ ...parsed.data, budget_id: id });
  return Response.json(created, { status: 201 });
}
