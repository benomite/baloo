import { z } from 'zod';
import { updateCompteBancaire, COMPTE_TYPES, COMPTE_STATUTS } from '@/lib/services/comptes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  nom: z.string().optional(),
  banque: z.string().nullish(),
  iban: z.string().nullish(),
  bic: z.string().nullish(),
  type_compte: z.enum(COMPTE_TYPES).optional(),
  comptaweb_id: z.number().int().nullish(),
  statut: z.enum(COMPTE_STATUTS).optional(),
  ouvert_le: z.string().nullish(),
  ferme_le: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { groupId } = requireApiContext();
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateCompteBancaire({ groupId }, id, parsed.data);
  if (!updated) return jsonError('Compte introuvable.', 404);
  return Response.json(updated);
}
