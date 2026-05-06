import { z } from 'zod';
import {
  syncCaisseFromComptaweb,
  discoverCaisses,
  resolveCaisseId,
} from '@/lib/services/caisse-sync';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';
import { ComptawebSessionExpiredError } from '@/lib/comptaweb/http';
import { logError } from '@/lib/log';

const postSchema = z.object({
  caisse_id: z.number().int().positive().optional(),
});

// GET : liste les caisses Comptaweb (pour le user qui veut savoir
// quelle caisse choisir si plusieurs existent).
export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  try {
    const list = await discoverCaisses();
    return Response.json({ caisses: list });
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) return jsonError('Session Comptaweb expirée.', 401);
    logError('caisse/sync/list', 'discoverCaisses', err);
    return jsonError(err instanceof Error ? err.message : 'Erreur inconnue.', 500);
  }
}

// POST : déclenche un pull pour la caisse cible. Si non précisé, prend
// la première caisse active.
export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, postSchema);
  if ('error' in parsed) return parsed.error;

  try {
    const caisseId = parsed.data.caisse_id ?? (await resolveCaisseId());
    const result = await syncCaisseFromComptaweb(groupId, caisseId);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ComptawebSessionExpiredError) return jsonError('Session Comptaweb expirée.', 401);
    logError('caisse/sync/post', 'syncCaisseFromComptaweb', err);
    return jsonError(err instanceof Error ? err.message : 'Erreur inconnue.', 500);
  }
}
