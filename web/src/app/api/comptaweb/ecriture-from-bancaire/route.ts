import { z } from 'zod';
import { ensureComptawebEnv } from '@/lib/comptaweb/env-loader';
import { withAutoReLogin } from '@/lib/comptaweb';
import { createEcritureFromLigneBancaire } from '@/lib/comptaweb/ecritures-from-bancaire';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

ensureComptawebEnv();

const ventilationSchema = z.object({
  montant: z.string(),
  natureId: z.string(),
  activiteId: z.string(),
  brancheprojetId: z.string(),
});

const fromBancaireSchema = z.object({
  ligneBancaireId: z.number().int(),
  sousLigneIndex: z.number().int().optional(),
  ventilation: ventilationSchema,
  libelOverride: z.string().optional(),
  modetransactionIdOverride: z.string().optional(),
  numeropiece: z.string().optional(),
  tiersCategId: z.string().optional(),
  tiersStructureId: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const parsed = await parseJsonBody(request, fromBancaireSchema);
  if ('error' in parsed) return parsed.error;
  try {
    const result = await withAutoReLogin((cfg) =>
      createEcritureFromLigneBancaire(cfg, parsed.data),
    );
    return Response.json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502);
  }
}
