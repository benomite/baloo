import { z } from 'zod';
import { ensureComptawebEnv } from '@/lib/comptaweb/env-loader';
import { withAutoReLogin, createEcriture } from '@/lib/comptaweb';
import type { CreateEcritureInput } from '@/lib/comptaweb';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

ensureComptawebEnv();

const ventilationSchema = z.object({
  montant: z.string(),
  natureId: z.string(),
  activiteId: z.string(),
  brancheprojetId: z.string(),
});

const createSchema = z.object({
  type: z.enum(['depense', 'recette']),
  libel: z.string().min(1),
  dateecriture: z.string(),
  montant: z.string(),
  numeropiece: z.string().optional(),
  modetransactionId: z.string(),
  comptebancaireId: z.string().optional(),
  chequierId: z.string().optional(),
  chequenumValue: z.string().optional(),
  cartebancaireId: z.string().optional(),
  carteprocurementId: z.string().optional(),
  caisseId: z.string().optional(),
  tiersCategId: z.string(),
  tiersStructureId: z.string(),
  ventilations: z.array(ventilationSchema).min(1),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const { dryRun, ...input } = parsed.data;
  try {
    const result = await withAutoReLogin((cfg) =>
      createEcriture(cfg, input as CreateEcritureInput, { dryRun: dryRun !== false }),
    );
    return Response.json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502);
  }
}
