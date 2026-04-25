import { getCurrentContext } from '../context';
import { listMouvementsCaisse as listMouvementsCaisseService } from '../services/caisse';
import type { MouvementCaisse } from '../types';

export function listMouvementsCaisse(limit = 50): { mouvements: MouvementCaisse[]; solde: number } {
  return listMouvementsCaisseService({ groupId: getCurrentContext().groupId }, { limit });
}
