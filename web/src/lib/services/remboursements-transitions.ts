// Garde de transitions du workflow remboursements : qui peut faire
// quoi sur la timeline à 5 statuts. Module pur (pas d'I/O) — extrait
// de la server action `updateRemboursementStatus` pour pouvoir le
// tester sans BDD ni session.

export interface TransitionGuard {
  /** Statuts autorisés en source (depuis quoi peut-on passer à ce statut). */
  from: string[];
  /** Rôles autorisés à déclencher la transition. */
  allowedRoles: string[];
}

export const REMBOURSEMENTS_TRANSITIONS: Record<string, TransitionGuard> = {
  valide_tresorier: { from: ['a_traiter'], allowedRoles: ['tresorier'] },
  valide_rg: { from: ['valide_tresorier'], allowedRoles: ['RG'] },
  virement_effectue: { from: ['valide_rg'], allowedRoles: ['tresorier', 'RG'] },
  termine: { from: ['virement_effectue'], allowedRoles: ['tresorier', 'RG'] },
  refuse: {
    from: ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue'],
    allowedRoles: ['tresorier', 'RG'],
  },
};

export function getRembsTransitionGuard(targetStatus: string): TransitionGuard | null {
  return REMBOURSEMENTS_TRANSITIONS[targetStatus] ?? null;
}

export function isAllowedRembsTransition(
  fromStatus: string,
  targetStatus: string,
  role: string,
): { ok: true } | { ok: false; reason: 'unknown_status' | 'wrong_source' | 'wrong_role' } {
  const guard = getRembsTransitionGuard(targetStatus);
  if (!guard) return { ok: false, reason: 'unknown_status' };
  if (!guard.allowedRoles.includes(role)) return { ok: false, reason: 'wrong_role' };
  if (!guard.from.includes(fromStatus)) return { ok: false, reason: 'wrong_source' };
  return { ok: true };
}
