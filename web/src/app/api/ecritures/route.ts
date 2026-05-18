import { z } from 'zod';
import {
  listEcritures,
  createEcriture,
  type EcritureFilters,
} from '@/lib/services/ecritures';
import { ECRITURE_STATUSES } from '@/lib/types';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';
import { resolveStatusFilter } from './status-filter';

// Doctrine (pivot miroir strict + MCP-first) :
// GET /api/ecritures sert le miroir CW propre. Par défaut, ne retourne
// que `status='mirror'`. L'opt-in `?includeDivergent=1` ajoute les
// `divergent`. Les drafts / pending_cw / pending_sync vivent sur /inbox
// — ils ne sortent JAMAIS via cet endpoint sauf override explicite via
// `?status=draft` (cas usage MCP/audit).
const listSchema = z
  .object({
    unite_id: z.string().optional(),
    category_id: z.string().optional(),
    type: z.enum(['depense', 'recette']).optional(),
    date_debut: z.string().optional(),
    date_fin: z.string().optional(),
    mode_paiement_id: z.string().optional(),
    carte_id: z.string().optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    status: z.enum(ECRITURE_STATUSES).optional(),
    // Opt-in : si `1`/`true`, ajoute les `divergent` aux `mirror` du
    // filtre par défaut. Ignoré si `status` est forcé.
    includeDivergent: z.string().optional(),
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
  const { groupId, scopeUniteId } = ctxR.ctx;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);

  const { includeDivergent, status, ...rest } = parsed.data;
  const statusIn = resolveStatusFilter({ status, includeDivergent });
  const filters: EcritureFilters = { ...rest, statusIn };

  return Response.json(await listEcritures({ groupId, scopeUniteId }, filters));
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
  carte_id: z.string().nullish(),
  justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteId } = ctxR.ctx;
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  const created = await createEcriture({ groupId, scopeUniteId }, parsed.data);
  return Response.json(created, { status: 201 });
}
