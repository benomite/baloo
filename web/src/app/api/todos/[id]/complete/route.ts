import { completeTodo } from '@/lib/services/todos';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { groupId, userId } = requireApiContext();
  const { id } = await params;
  const updated = completeTodo({ groupId, userId }, id);
  if (!updated) return jsonError('Tâche introuvable.', 404);
  return Response.json(updated);
}
