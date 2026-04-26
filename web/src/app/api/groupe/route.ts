import { z } from 'zod';
import { getGroupe, updateGroupe } from '@/lib/services/groupes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const groupe = getGroupe({ groupId });
  if (!groupe) return jsonError('Groupe introuvable.', 404);
  return Response.json(groupe);
}

const patchSchema = z.object({
  nom: z.string().optional(),
  territoire: z.string().nullish(),
  adresse: z.string().nullish(),
  email_contact: z.string().nullish(),
  iban_principal: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function PATCH(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateGroupe({ groupId }, parsed.data);
  if (!updated) return jsonError('Groupe introuvable.', 404);
  return Response.json(updated);
}
