import { z } from 'zod';
import { attachJustificatif } from '@/lib/services/justificatifs';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const ENTITY_TYPES = ['ecriture', 'remboursement', 'abandon', 'depot', 'mouvement'] as const;

const metaSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().min(1),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('multipart/form-data attendu.', 415);
  }

  const form = await request.formData();
  const entityType = form.get('entity_type');
  const entityId = form.get('entity_id');
  const file = form.get('file');

  const parsed = metaSchema.safeParse({ entity_type: entityType, entity_id: entityId });
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  if (!(file instanceof File)) return jsonError('Fichier requis.', 400);

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const created = await attachJustificatif(
      { groupId },
      {
        entity_type: parsed.data.entity_type,
        entity_id: parsed.data.entity_id,
        filename: file.name,
        content: buf,
        mime_type: file.type || 'application/octet-stream',
      },
    );
    return Response.json(created, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue.';
    return jsonError(msg, 400);
  }
}
