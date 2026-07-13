// Ventiler un draft existant en N lignes groupées (`ventilation_group_id`).
// Le body ne porte pas le total : le service dérive Σ de la tête et valide
// que Σ(ventilations) == amount_cents de la tête. Cf. task-3-brief.md.

import { z } from 'zod';
import { ventilateDraft, type VentilateReason } from '@/lib/services/ecritures-ventilate';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const ventilationSchema = z.object({
  amount_cents: z.number().int(),
  category_id: z.string().nullable(),
  unite_id: z.string().nullable(),
  activite_id: z.string().nullable(),
});
const bodySchema = z.object({ ventilations: z.array(ventilationSchema).min(1) });

const STATUS: Record<VentilateReason, number> = {
  not_found: 404, not_draft: 409, in_cw: 409, sum_mismatch: 409, incomplete: 400, child_has_attachments: 409,
};
const MESSAGE: Record<VentilateReason, string> = {
  not_found: 'Écriture introuvable.',
  not_draft: 'Seul un brouillon peut être ventilé.',
  in_cw: 'Écriture déjà dans Comptaweb — non ventilable.',
  sum_mismatch: 'La somme des détails doit être égale au total.',
  incomplete: 'Chaque détail doit avoir montant, catégorie, activité et unité.',
  child_has_attachments: 'Une ligne à retirer porte une pièce jointe — détachez-la d\'abord.',
};

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteIds } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  const result = await ventilateDraft({ groupId, scopeUniteIds }, id, parsed.data.ventilations);
  if (!result.ok && result.reason) {
    return jsonError(MESSAGE[result.reason], STATUS[result.reason]);
  }
  return Response.json(result);
}
