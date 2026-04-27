import { z } from 'zod';
import { importComptawebCsv } from '@/lib/services/comptaweb-import';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const importSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, importSchema);
  if ('error' in parsed) return parsed.error;
  const result = importComptawebCsv({ groupId }, parsed.data);
  if (!result.ok) return jsonError(result.message ?? 'Import échoué.', 400);
  return Response.json(result);
}
