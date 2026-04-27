import { z } from 'zod';
import { getRemboursement, updateRemboursement } from '@/lib/services/remboursements';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const { id } = await params;
  const remboursement = getRemboursement({ groupId }, id);
  if (!remboursement) return jsonError('Remboursement introuvable.', 404);
  return Response.json(remboursement);
}

const patchSchema = z.object({
  status: z.enum(['demande', 'valide', 'paye', 'refuse']).optional(),
  date_paiement: z.string().nullish(),
  mode_paiement_id: z.string().nullish(),
  justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
  comptaweb_synced: z.boolean().optional(),
  ecriture_id: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = updateRemboursement({ groupId }, id, parsed.data);
  if (!updated) return jsonError('Remboursement introuvable.', 404);
  return Response.json(updated);
}
