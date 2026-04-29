import { redirect } from 'next/navigation';

// Helpers d'autorisation par rôle (chantier 5, hiérarchie V2 : ADR-019).
//
// La sidebar masque déjà les liens non pertinents pour le rôle, mais un
// user peut toujours taper une URL directement. Ces helpers protègent
// les pages côté serveur en redirigeant si le rôle ne matche pas. Les
// filtres de données (scope unité) restent appliqués indépendamment au
// niveau des services.

export const ADMIN_ROLES = ['tresorier', 'RG'] as const;
export const COMPTA_ROLES = ['tresorier', 'RG', 'chef'] as const;
export const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'equipier'] as const;

export function requireRole(currentRole: string, allowedRoles: readonly string[]): void {
  if (!allowedRoles.includes(currentRole)) {
    redirect('/');
  }
}

// Sucres pour les cas les plus fréquents.

// `tresorier` ou `RG` : accès complet à l'admin.
export function requireAdmin(currentRole: string): void {
  requireRole(currentRole, ADMIN_ROLES);
}

// `tresorier`, `RG` ou `chef` : peut voir des pages de compta (le filtre
// scope unité est appliqué au niveau des services pour `chef`).
export function requireComptaAccess(currentRole: string): void {
  requireRole(currentRole, COMPTA_ROLES);
}

// Tout rôle authentifié sauf `parent` peut soumettre (justifs, demandes).
export function requireCanSubmit(currentRole: string): void {
  requireRole(currentRole, SUBMIT_ROLES);
}

// `parent` est cantonné à /moi.
export function requireNotParent(currentRole: string): void {
  if (currentRole === 'parent') {
    redirect('/moi');
  }
}
