import { getCurrentContext } from '../context';
import {
  listRemboursements as listRemboursementsService,
  getRemboursement as getRemboursementService,
  type RemboursementFilters,
} from '../services/remboursements';
import type { Remboursement } from '../types';

export type { RemboursementFilters };

export function listRemboursements(filters: RemboursementFilters = {}): Remboursement[] {
  return listRemboursementsService({ groupId: getCurrentContext().groupId }, filters);
}

export function getRemboursement(id: string): Remboursement | undefined {
  return getRemboursementService({ groupId: getCurrentContext().groupId }, id);
}
