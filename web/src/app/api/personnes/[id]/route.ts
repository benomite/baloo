import { z } from 'zod';
import { updatePersonne, PERSONNE_ROLES } from '@/lib/services/personnes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  prenom: z.string().optional(),
  nom: z.string().nullish(),
  email: z.string().email().nullish(),
  telephone: z.string().nullish(),
  role_groupe: z.enum(PERSONNE_ROLES).nullish(),
  unite_id: z.string().nullish(),
  statut: z.enum(['actif', 'ancien', 'inactif']).optional(),
  depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  jusqu_a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = await updatePersonne({ groupId }, id, parsed.data);
  if (!updated) return jsonError('Personne introuvable.', 404);
  return Response.json(updated);
}
