import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { getDb } from '@/lib/db';
import { requireApiContext } from '@/lib/api/route-helpers';

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

  const result = await getStorage().fetch(relPath);
  if (!result) {
    return NextResponse.json({ error: 'Fichier non trouvé' }, { status: 404 });
  }
  // `as BodyInit` : TS 5.x distingue `Uint8Array<ArrayBufferLike>` de
  // `BodyInit` à cause du generic ; à l'exécution `Response` accepte
  // sans souci les deux types qu'on lui passe ici.
  return new NextResponse(result.body as BodyInit, {
    headers: {
      'Content-Type': result.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
}
