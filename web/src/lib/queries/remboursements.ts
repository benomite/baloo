import { getCurrentContext } from '../context';
import {
  listRemboursements as listRemboursementsService,
  getRemboursement as getRemboursementService,
  type RemboursementFilters,
} from '../services/remboursements';
import type { Remboursement } from '../types';

export type { RemboursementFilters };

export async function listRemboursements(filters: RemboursementFilters = {}): Promise<Remboursement[]> {
  const { groupId } = await getCurrentContext();
  return listRemboursementsService({ groupId }, filters);
}

export async function getRemboursement(id: string): Promise<Remboursement | undefined> {
  const { groupId } = await getCurrentContext();
  return getRemboursementService({ groupId }, id);
}
