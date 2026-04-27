import { getCurrentContext } from '../context';
import {
  listRemboursements as listRemboursementsService,
  getRemboursement as getRemboursementService,
  type RemboursementFilters,
} from '../services/remboursements';
import type { Remboursement } from '../types';

export type { RemboursementFilters };

export async function listRemboursements(filters: RemboursementFilters = {}): Promise<Remboursement[]> {
  const { groupId, scopeUniteId } = await getCurrentContext();
  return listRemboursementsService({ groupId, scopeUniteId }, filters);
}

export async function getRemboursement(id: string): Promise<Remboursement | undefined> {
  const { groupId, scopeUniteId } = await getCurrentContext();
  return getRemboursementService({ groupId, scopeUniteId }, id);
}
