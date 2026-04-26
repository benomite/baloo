import { z } from 'zod';
import { updateNote, deleteNote } from '@/lib/services/notes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  topic: z.string().optional(),
  title: z.string().nullish(),
  content_md: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateNote({ groupId, userId }, id, parsed.data);
  if (!updated) return jsonError('Note introuvable.', 404);
  return Response.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const { id } = await params;
  if (!deleteNote({ groupId, userId }, id)) return jsonError('Note introuvable.', 404);
  return new Response(null, { status: 204 });
}
