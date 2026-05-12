import { z } from 'zod';
import { listInboxItems, INBOX_PERIODS, type InboxPeriod } from '@/lib/queries/inbox';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

const querySchema = z
  .object({
    period: z.enum(INBOX_PERIODS).optional(),
    recettes: z
      .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
      .optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const period: InboxPeriod = parsed.data.period ?? '90j';
  const includeRecettes = parsed.data.recettes === '1' || parsed.data.recettes === 'true';

  const data = await listInboxItems({ groupId, period, includeRecettes });

  return Response.json({
    period,
    include_recettes: includeRecettes,
    count: data.ecrituresOrphelines.length,
    truncated: data.ecrituresTruncated > 0,
    truncated_count: data.ecrituresTruncated,
    ecritures: data.ecrituresOrphelines,
  });
}
