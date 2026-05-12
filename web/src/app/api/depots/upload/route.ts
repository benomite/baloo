import { z } from 'zod';
import { createDepot, attachDepotToEcriture } from '@/lib/services/depots';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const metaSchema = z
  .object({
    titre: z.string().min(1),
    montant_estime: z.string().optional(),
    date_estimee: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ecriture_id: z.string().optional(),
  })
  .strict();

function parseAmountFr(input: string | undefined): number | null {
  if (!input) return null;
  const normalized = input.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('multipart/form-data attendu.', 415);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('Fichier requis.', 400);

  const meta = {
    titre: (form.get('titre') as string | null) ?? undefined,
    montant_estime: (form.get('montant_estime') as string | null) ?? undefined,
    date_estimee: (form.get('date_estimee') as string | null) ?? undefined,
    ecriture_id: (form.get('ecriture_id') as string | null) ?? undefined,
  };

  const parsed = metaSchema.safeParse(meta);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const buf = Buffer.from(await file.arrayBuffer());

  const created = await createDepot(
    { groupId, userId },
    {
      titre: parsed.data.titre,
      amount_cents: parseAmountFr(parsed.data.montant_estime),
      date_estimee: parsed.data.date_estimee ?? null,
      file: {
        filename: file.name,
        content: buf,
        mime_type: file.type || 'application/octet-stream',
      },
    },
  );

  let attached: { ecriture_id: string } | null = null;
  if (parsed.data.ecriture_id) {
    try {
      await attachDepotToEcriture({ groupId }, created.id, parsed.data.ecriture_id);
      attached = { ecriture_id: parsed.data.ecriture_id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attach failed';
      return Response.json({ depot_id: created.id, attach_error: msg }, { status: 201 });
    }
  }

  return Response.json({ depot_id: created.id, attached }, { status: 201 });
}
