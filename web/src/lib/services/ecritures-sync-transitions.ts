// Guards purs des transitions de statut liées à la réconciliation
// Comptaweb (spec doc/specs/2026-06-01-sync-reconciliation-design.md).
//
// Module SANS dépendance BDD/HTTP : testable en isolation, réutilisable
// par le cycle de sync et les server actions d'arbitrage. Même pattern
// que `remboursements-transitions.ts`.

export type EcritureStatus =
  | 'draft'
  | 'pending_cw'
  | 'pending_sync'
  | 'mirror'
  | 'divergent'
  | 'supprimee_cw';

export const ECRITURE_STATUSES: readonly EcritureStatus[] = [
  'draft',
  'pending_cw',
  'pending_sync',
  'mirror',
  'divergent',
  'supprimee_cw',
] as const;

// Transitions provoquées par la sync ou l'arbitrage utilisateur. Les
// transitions du push (draft→pending_cw→pending_sync) vivent ailleurs
// (ecritures-create) ; ici on ne couvre que le périmètre réconciliation.
const ALLOWED: Record<EcritureStatus, EcritureStatus[]> = {
  draft: ['mirror'], // promotion par match contenu confiant (ou confirmation de lien)
  pending_cw: [],
  pending_sync: ['mirror', 'divergent', 'supprimee_cw'],
  mirror: ['supprimee_cw'], // disparue de CW
  divergent: ['mirror', 'supprimee_cw'],
  supprimee_cw: ['draft'], // arbitrage : restaurer en brouillon local
};

/**
 * Vrai si la transition `from → to` est autorisée dans le cadre de la
 * réconciliation. L'identité (`from === to`) est toujours autorisée
 * (no-op idempotent).
 */
export function isAllowedSyncTransition(from: EcritureStatus, to: EcritureStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.includes(to) ?? false;
}

/**
 * Vrai si une écriture peut être supprimée définitivement (DELETE BDD).
 * Garde-fou strict (cf. CLAUDE.md « JAMAIS de DELETE » + exception
 * `deleteDraftEcriture`) : uniquement un `draft` ou une `supprimee_cw`,
 * ET aucune pièce attachée (justif, dépôt, remboursement, abandon).
 */
export function canHardDelete(status: EcritureStatus, hasAttachments: boolean): boolean {
  if (hasAttachments) return false;
  return status === 'draft' || status === 'supprimee_cw';
}
