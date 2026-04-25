import { z } from 'zod';
import { syncDraftToComptaweb } from '@/lib/services/drafts';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const bodySchema = z.object({
  dryRun: z.boolean().optional(),
});

// POST /api/drafts/:id/sync — body optionnel, dryRun=true par défaut (safety).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { groupId } = requireApiContext();
  const { id } = await params;

  let opts: { dryRun?: boolean } = {};
  const text = await request.text();
  if (text.trim()) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return jsonError('Body JSON invalide.', 400);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return jsonError('Validation échouée.', 400);
    opts = parsed.data;
  }

  // Le service peut renvoyer ok=false pour des raisons métier (champs manquants,
  // écriture introuvable, session Comptaweb expirée). On garde HTTP 200 et on
  // laisse l'appelant lire `ok`/`message`/`missingFields` dans le body.
  return Response.json(await syncDraftToComptaweb({ groupId }, id, opts));
}
