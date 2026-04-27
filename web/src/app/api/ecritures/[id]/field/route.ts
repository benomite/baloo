import { z } from 'zod';
import { updateEcritureField, type InlineField } from '@/lib/services/ecritures';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const fieldSchema = z.object({
  field: z.enum(['unite_id', 'category_id', 'activite_id', 'mode_paiement_id', 'carte_id', 'justif_attendu', 'notes']),
  value: z.union([z.string(), z.number(), z.null()]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, fieldSchema);
  if ('error' in parsed) return parsed.error;
  const result = updateEcritureField({ groupId, scopeUniteId }, id, parsed.data.field as InlineField, parsed.data.value);
  if (!result.ok) {
    if (result.reason === 'not_found') return jsonError('Écriture introuvable.', 404);
    if (result.reason === 'sync_locked') return jsonError('Écriture synchronisée Comptaweb — champ non modifiable.', 409);
    return jsonError('Champ non autorisé.', 400);
  }
  return Response.json(result.ecriture);
}
