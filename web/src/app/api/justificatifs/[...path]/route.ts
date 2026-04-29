import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { getDb } from '@/lib/db';
import { requireApiContext } from '@/lib/api/route-helpers';

// GET /api/justificatifs/<entity_type>/<entity_id>/<filename>
// Sert le file justif. Auth obligatoire (session ou Bearer MCP) ET le
// justif doit appartenir au groupe du user. Pas de filtrage par rôle au
// MVP : tout user authentifié du groupe peut voir tous les justifs du
// groupe. À raffiner si besoin (chef → son unité, equipier → siens).

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;

  const { path } = await params;
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
  if (result.redirectUrl) {
    return NextResponse.redirect(result.redirectUrl, { status: 302 });
  }
  return new NextResponse(new Uint8Array(result.body!), {
    headers: { 'Content-Type': result.contentType ?? 'application/octet-stream' },
  });
}
