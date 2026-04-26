import { z } from 'zod';
import { listNotes, createNote } from '@/lib/services/notes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    topic: z.string().optional(),
    user_only: z.coerce.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listNotes({ groupId, userId }, parsed.data));
}

const createSchema = z.object({
  topic: z.string().min(1),
  title: z.string().nullish(),
  content_md: z.string().min(1),
  shared: z.boolean().optional(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(createNote({ groupId, userId }, parsed.data), { status: 201 });
}
