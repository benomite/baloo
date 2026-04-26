import { z } from 'zod';
import {
  listEcritures,
  createEcriture,
  type EcritureFilters,
} from '@/lib/services/ecritures';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({
    unite_id: z.string().optional(),
    category_id: z.string().optional(),
    type: z.enum(['depense', 'recette']).optional(),
    date_debut: z.string().optional(),
    date_fin: z.string().optional(),
    mode_paiement_id: z.string().optional(),
    status: z.enum(['brouillon', 'valide', 'saisie_comptaweb']).optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    incomplete: z.coerce.boolean().optional(),
    from_bank: z.coerce.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listEcritures({ groupId }, parsed.data as EcritureFilters));
}

const createSchema = z.object({
  date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount_cents: z.number().int(),
  type: z.enum(['depense', 'recette']),
  unite_id: z.string().nullish(),
  category_id: z.string().nullish(),
  mode_paiement_id: z.string().nullish(),
  activite_id: z.string().nullish(),
  numero_piece: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const created = createEcriture({ groupId }, parsed.data);
  return Response.json(created, { status: 201 });
}
