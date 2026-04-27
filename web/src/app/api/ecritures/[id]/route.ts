import { z } from 'zod';
import { getEcriture, updateEcriture } from '@/lib/services/ecritures';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const { id } = await params;
  const ecriture = getEcriture({ groupId, scopeUniteId }, id);
  if (!ecriture) return jsonError('Écriture introuvable.', 404);
  return Response.json(ecriture);
}

const patchSchema = z.object({
  date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().optional(),
  amount_cents: z.number().int().optional(),
  type: z.enum(['depense', 'recette']).optional(),
  unite_id: z.string().nullish(),
  category_id: z.string().nullish(),
  mode_paiement_id: z.string().nullish(),
  activite_id: z.string().nullish(),
  numero_piece: z.string().nullish(),
  carte_id: z.string().nullish(),
  justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  status: z.enum(['brouillon', 'valide', 'saisie_comptaweb']).optional(),
  comptaweb_synced: z.boolean().optional(),
  notes: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateEcriture({ groupId, scopeUniteId }, id, parsed.data);
  if (!updated) return jsonError('Écriture introuvable.', 404);
  return Response.json(updated);
}
