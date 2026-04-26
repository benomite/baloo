import { z } from 'zod';
import { listTodos, createTodo, TODO_STATUSES } from '@/lib/services/todos';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    status: z.enum(TODO_STATUSES).optional(),
    include_fait: z.coerce.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listTodos({ groupId, userId }, parsed.data));
}

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  status: z.enum(TODO_STATUSES).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(createTodo({ groupId, userId }, parsed.data), { status: 201 });
}
