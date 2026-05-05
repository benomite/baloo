import { getCurrentContext } from '../context';
import { listMouvementsCaisse as listMouvementsCaisseService } from '../services/caisse';
import {
  listDepotsEspeces as listDepotsEspecesService,
  listCandidateEcrituresForDepot,
  type CandidateEcritureBanque,
} from '../services/depots-especes';
import type { MouvementCaisse, DepotEspeces } from '../types';

export async function listMouvementsCaisse(
  limit = 100,
): Promise<{ mouvements: MouvementCaisse[]; solde: number }> {
  const { groupId } = await getCurrentContext();
  return listMouvementsCaisseService({ groupId }, { limit });
}

export async function listDepotsEspeces(
  options: { limit?: number; pending_only?: boolean } = {},
): Promise<DepotEspeces[]> {
  const { groupId } = await getCurrentContext();
  return listDepotsEspecesService({ groupId }, options);
}

// Pour chaque dépôt en attente, charge les écritures candidates en
// parallèle. Renvoie un tableau ordonné depot+candidates pour faciliter
// le rendu UI.
export async function listDepotsAvecCandidates(): Promise<
  Array<{ depot: DepotEspeces; candidates: CandidateEcritureBanque[] }>
> {
  const { groupId } = await getCurrentContext();
  const depots = await listDepotsEspecesService({ groupId }, { pending_only: true });
  return await Promise.all(
    depots.map(async (depot) => ({
      depot,
      candidates: await listCandidateEcrituresForDepot(
        { groupId },
        { amount_cents: depot.total_amount_cents, date: depot.date_depot },
      ),
    })),
  );
}
