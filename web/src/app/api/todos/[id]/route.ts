import { z } from 'zod';
import { updateTodo, TODO_STATUSES } from '@/lib/services/todos';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  status: z.enum(TODO_STATUSES).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateTodo({ groupId, userId }, id, parsed.data);
  if (!updated) return jsonError('Tâche introuvable.', 404);
  return Response.json(updated);
}
