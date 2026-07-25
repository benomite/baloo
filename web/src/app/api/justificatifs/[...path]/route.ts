import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { fetchJustifWithTimeout, readBodyWithTimeout } from '@/lib/justif-fetch';
import { getDb } from '@/lib/db';
import { requireApiContext } from '@/lib/api/route-helpers';
import { logError } from '@/lib/log';

// Backstop plateforme : borne la durée de la lambda quoi qu'il arrive.
export const maxDuration = 30;

// Deux gardes de délai distinctes :
// - `FETCH_TIMEOUT_MS` borne la RÉSOLUTION du `get()` storage.
// - `BODY_READ_TIMEOUT_MS` borne le TRANSFERT du corps (drain du stream
//   Vercel Blob). C'est CE maillon qui pouvait pendre à l'infini sans erreur
//   (charge indéfiniment côté client) : `get()` résout vite puis le stream
//   cale. Voir `readBodyWithTimeout`.
const FETCH_TIMEOUT_MS = 10_000;
const BODY_READ_TIMEOUT_MS = 15_000;

// GET /api/justificatifs/<entity_type>/<entity_id>/<filename>
// Sert le file justif. Auth obligatoire (session ou Bearer MCP) ET le
// justif doit appartenir au groupe du user. Pas de filtrage par rôle au
// MVP : tout user authentifié du groupe peut voir tous les justifs du
// groupe. À raffiner si besoin (chef → son unité, equipier → siens).
//
// Les blobs Vercel sont privés (cf. lib/storage.ts) — on streame le
// contenu via cette route, on ne redirige plus vers une URL publique.

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;

  const { path } = await params;
  // Garde-fou path traversal : aucun segment ne doit contenir `..` ou
  // commencer par `/`. La route Next.js décode déjà les `%2F`, donc on
  // valide segment par segment.
  if (path.some((seg) => seg === '' || seg === '..' || seg.includes('/') || seg.includes('\\'))) {
    return NextResponse.json({ error: 'Chemin invalide' }, { status: 400 });
  }
  const relPath = path.join('/');

  // Vérification : le justif référencé existe et appartient au groupe.
  const justif = await getDb()
    .prepare('SELECT group_id FROM justificatifs WHERE file_path = ? LIMIT 1')
    .get<{ group_id: string }>(relPath);
  if (!justif || justif.group_id !== ctxR.ctx.groupId) {
    return NextResponse.json({ error: 'Fichier non trouvé' }, { status: 404 });
  }

  const outcome = await fetchJustifWithTimeout(
    (p) => getStorage().fetch(p),
    relPath,
    FETCH_TIMEOUT_MS,
  );
  if (outcome.status === 'timeout') {
    logError('justificatifs', 'Lecture justif : délai storage dépassé (blob injoignable ?)', undefined, { relPath });
    return NextResponse.json({ error: 'Justificatif temporairement injoignable.' }, { status: 502 });
  }
  if (outcome.status === 'error') {
    logError('justificatifs', 'Lecture justif : erreur storage', outcome.error, { relPath });
    return NextResponse.json({ error: 'Erreur lors de la lecture du justificatif.' }, { status: 502 });
  }
  const result = outcome.result;
  if (!result) {
    return NextResponse.json({ error: 'Fichier non trouvé' }, { status: 404 });
  }

  // Draine le corps sous garde de délai plutôt que de streamer tel quel : un
  // stream qui cale en transfert pendait à l'infini (aucune erreur levée).
  // Au timeout, `readBodyWithTimeout` annule le reader → libère la lambda.
  const bodyOut = await readBodyWithTimeout(result.body, BODY_READ_TIMEOUT_MS);
  if (bodyOut.status === 'timeout') {
    logError('justificatifs', 'Lecture justif : transfert du corps interrompu (délai dépassé)', undefined, { relPath });
    return NextResponse.json({ error: 'Justificatif temporairement injoignable.' }, { status: 502 });
  }
  if (bodyOut.status === 'error') {
    logError('justificatifs', 'Lecture justif : erreur pendant le transfert du corps', bodyOut.error, { relPath });
    return NextResponse.json({ error: 'Erreur lors de la lecture du justificatif.' }, { status: 502 });
  }

  // Corps complet et de longueur connue → pas de tail de stream ouvert vers le
  // client. `as BodyInit` : TS 5.x distingue `Uint8Array<ArrayBufferLike>` de
  // `BodyInit` à cause du generic ; `Response` l'accepte sans souci au runtime.
  return new NextResponse(bodyOut.bytes as BodyInit, {
    headers: {
      'Content-Type': result.contentType ?? 'application/octet-stream',
      'Content-Length': String(bodyOut.bytes.length),
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
}
