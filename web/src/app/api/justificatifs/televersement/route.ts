import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';
import { getStorage, storageMode } from '@/lib/storage';
import { checkJustifMeta, mimeFromFilename, sanitizeFilename } from '@/lib/justif-allowed';
import {
  buildUploadTokenOptions,
  recordLocalUpload,
  recordUploadCompleted,
  televersementPrefix,
} from '@/lib/services/justif-televersements';
import { JustificatifValidationError } from '@/lib/services/justificatifs';
import { logError } from '@/lib/log';

// Téléversement direct des justificatifs (ticket #28) — cf.
// `lib/services/justif-televersements.ts` pour le cycle complet.
//
// GET  → configuration de l'uploader : mode (`blob` | `local`) et préfixe
//        de pathname imposé au user connecté.
// POST → protocole `handleUpload` de `@vercel/blob/client` : signature du
//        token (navigateur, authentifié) ET callback `onUploadCompleted`
//        (appelé par Vercel, signé avec le token Blob — pas de session).
// PUT  → repli `local` (aucun Blob configuré, dev) : le fichier arrive ici
//        et part sur le FS. Jamais disponible sur Vercel.

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, userId } = ctxR.ctx;
  return NextResponse.json({
    mode: storageMode(),
    prefix: televersementPrefix({ groupId, userId }),
  });
}

export async function POST(request: Request) {
  if (storageMode() !== 'blob') return jsonError('Stockage Blob non configuré.', 404);

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return jsonError('Body JSON invalide.', 400);
  }

  try {
    const result = await handleUpload({
      body,
      request,
      // Appelé uniquement pour la demande de token (navigateur) : c'est ici
      // que l'auth et toute la validation serveur se jouent. Un refus lève
      // → aucun token émis → aucun upload possible.
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const ctxR = await requireApiContext(request);
        if ('error' in ctxR) throw new JustificatifValidationError('Authentification requise.');
        return buildUploadTokenOptions(
          { groupId: ctxR.ctx.groupId, userId: ctxR.ctx.userId },
          pathname,
          clientPayload,
        );
      },
      // Prod uniquement (le callback exige une URL publique) : inscrit le
      // téléversement, avec le propriétaire lu dans le token signé.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        await recordUploadCompleted(blob, tokenPayload);
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JustificatifValidationError) return jsonError(err.message, 400);
    logError('justificatifs', 'Téléversement : signature ou callback refusé', err);
    return jsonError('Envoi refusé.', 400);
  }
}

export async function PUT(request: Request) {
  if (storageMode() !== 'local' || process.env.VERCEL) return jsonError('Non disponible.', 404);

  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const owner = { groupId: ctxR.ctx.groupId, userId: ctxR.ctx.userId };

  const filename = new URL(request.url).searchParams.get('filename')?.trim() ?? '';
  if (!filename) return jsonError('Nom de fichier requis.', 400);
  const contentType = request.headers.get('content-type') || mimeFromFilename(filename);
  const content = Buffer.from(await request.arrayBuffer());

  const err = checkJustifMeta({ filename, size: content.length, mime_type: contentType });
  if (err) return jsonError(`${filename} : ${err}`, 400);

  const pathname = `${televersementPrefix(owner)}${randomUUID().slice(0, 8)}-${sanitizeFilename(filename)}`;
  await getStorage().put({ path: pathname, content, contentType });
  await recordLocalUpload(owner, { pathname, filename, size: content.length, mime_type: contentType });

  return NextResponse.json({ pathname, filename }, { status: 201 });
}
