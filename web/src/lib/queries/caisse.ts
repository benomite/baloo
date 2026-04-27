import { getCurrentContext } from '../context';
import { listMouvementsCaisse as listMouvementsCaisseService } from '../services/caisse';
import type { MouvementCaisse } from '../types';

export async function listMouvementsCaisse(limit = 50): Promise<{ mouvements: MouvementCaisse[]; solde: number }> {
  const { groupId } = await getCurrentContext();
  return listMouvementsCaisseService({ groupId }, { limit });
}
