import { z } from 'zod';
import {
  listComptesBancaires,
  createCompteBancaire,
  COMPTE_TYPES,
  COMPTE_STATUTS,
} from '@/lib/services/comptes';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const listSchema = z
  .object({ statut: z.enum(COMPTE_STATUTS).optional() })
  .strict();

export async function GET(request: Request) {
  const { groupId } = requireApiContext();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) return jsonError('Paramètres invalides.', 400);
  return Response.json(listComptesBancaires({ groupId }, parsed.data));
}

const createSchema = z.object({
  code: z.string().min(1),
  nom: z.string().min(1),
  banque: z.string().nullish(),
  iban: z.string().nullish(),
  bic: z.string().nullish(),
  type_compte: z.enum(COMPTE_TYPES).nullish(),
  comptaweb_id: z.number().int().nullish(),
  ouvert_le: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(request: Request) {
  const { groupId } = requireApiContext();
  const parsed = await parseJsonBody(request, createSchema);
  if ('error' in parsed) return parsed.error;
  return Response.json(createCompteBancaire({ groupId }, parsed.data), { status: 201 });
}
