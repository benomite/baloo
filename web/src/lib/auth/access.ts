import { redirect } from 'next/navigation';

// Helpers d'autorisation par rôle (chantier 5).
//
// La sidebar masque déjà les liens non pertinents pour le rôle, mais un
// user peut toujours taper une URL directement. Ces helpers protègent
// les pages côté serveur en redirigeant vers `/` si le rôle ne matche
// pas. Les filtres de données (scope unité) restent appliqués
// indépendamment au niveau des services.

const ALL_ADMIN_ROLES = ['tresorier', 'cotresorier'];

export function requireRole(currentRole: string, allowedRoles: string[]): void {
  if (!allowedRoles.includes(currentRole)) {
    redirect('/');
  }
}

// Sucres pour les cas les plus fréquents.
export function requireAdmin(currentRole: string): void {
  requireRole(currentRole, ALL_ADMIN_ROLES);
}

export function requireNotParent(currentRole: string): void {
  if (currentRole === 'parent') {
    redirect('/moi');
  }
}
