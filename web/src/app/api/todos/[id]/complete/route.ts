import { completeTodo } from '@/lib/services/todos';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const { id } = await params;
  const updated = completeTodo({ groupId, userId }, id);
  if (!updated) return jsonError('Tâche introuvable.', 404);
  return Response.json(updated);
}
