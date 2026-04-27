import { z } from 'zod';
import { listBudgets, createBudget } from '@/lib/services/budgets';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z.object({ saison: z.string().optional() }).strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(await listBudgets({ groupId }, parsed.data));
}

const createSchema = z.object({
  saison: z.string().min(4),
  statut: z.enum(['projet', 'vote', 'cloture']).optional(),
  vote_le: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(await createBudget({ groupId }, parsed.data), { status: 201 });
}
