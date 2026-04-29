import { getCurrentContext } from '../context';
import {
  listRemboursements as listRemboursementsService,
  getRemboursement as getRemboursementService,
  type RemboursementFilters,
} from '../services/remboursements';
import type { Remboursement } from '../types';

export type { RemboursementFilters };

// Un equipier n'a accès qu'à ses propres demandes ; les autres rôles
// suivent leur scope habituel (chef → son unité, tresorier/RG → tout).
function scopedContext(role: string, userId: string, groupId: string, scopeUniteId: string | null) {
  return {
    groupId,
    scopeUniteId,
    submittedByUserId: role === 'equipier' ? userId : null,
  };
}

export async function listRemboursements(filters: RemboursementFilters = {}): Promise<Remboursement[]> {
  const ctx = await getCurrentContext();
  return listRemboursementsService(scopedContext(ctx.role, ctx.userId, ctx.groupId, ctx.scopeUniteId), filters);
}

export async function getRemboursement(id: string): Promise<Remboursement | undefined> {
  const ctx = await getCurrentContext();
  return getRemboursementService(scopedContext(ctx.role, ctx.userId, ctx.groupId, ctx.scopeUniteId), id);
}
