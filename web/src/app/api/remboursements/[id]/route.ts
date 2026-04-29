import { z } from 'zod';
import { getRemboursement, updateRemboursement } from '@/lib/services/remboursements';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const { id } = await params;
  const remboursement = await getRemboursement({ groupId, scopeUniteId }, id);
  if (!remboursement) return jsonError('Remboursement introuvable.', 404);
  return Response.json(remboursement);
}

const patchSchema = z.object({
  status: z.enum(['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue', 'termine', 'refuse']).optional(),
  date_paiement: z.string().nullish(),
  mode_paiement_id: z.string().nullish(),
  justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
  comptaweb_synced: z.boolean().optional(),
  ecriture_id: z.string().nullish(),
  notes: z.string().nullish(),
  motif_refus: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = await updateRemboursement({ groupId, scopeUniteId }, id, parsed.data);
  if (!updated) return jsonError('Remboursement introuvable.', 404);
  return Response.json(updated);
}
