import { z } from 'zod';
import { listPersonnes, createPersonne, PERSONNE_ROLES } from '@/lib/services/personnes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    statut: z.enum(['actif', 'ancien', 'inactif']).optional(),
    role: z.string().optional(),
    unite_id: z.string().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listPersonnes({ groupId }, parsed.data));
}

const createSchema = z.object({
  prenom: z.string().min(1),
  nom: z.string().nullish(),
  email: z.string().email().nullish(),
  telephone: z.string().nullish(),
  role_groupe: z.enum(PERSONNE_ROLES).nullish(),
  unite_id: z.string().nullish(),
  depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(createPersonne({ groupId }, parsed.data), { status: 201 });
}
