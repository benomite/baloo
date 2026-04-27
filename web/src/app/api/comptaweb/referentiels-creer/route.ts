import { ensureComptawebEnv } from '@/lib/comptaweb/env-loader';
import { withAutoReLogin, fetchReferentielsCreer } from '@/lib/comptaweb';
import { jsonError, requireApiContext } from '@/lib/api/route-helpers';

ensureComptawebEnv();

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  try {
    const refs = await withAutoReLogin((cfg) => fetchReferentielsCreer(cfg));
    return Response.json({
      depenserecette: refs.depenserecette,
      devise: refs.devise,
      modetransaction: refs.modetransaction,
      comptebancaire: refs.comptebancaire,
      chequier: refs.chequier,
      cartebancaire: refs.cartebancaire,
      carteprocurement: refs.carteprocurement,
      caisse: refs.caisse,
      tierscateg: refs.tierscateg,
      tiersstructure: refs.tiersstructure,
      nature: refs.nature,
      activite: refs.activite,
      brancheprojet: refs.brancheprojet,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 502);
  }
}
