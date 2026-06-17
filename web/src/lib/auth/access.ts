import { redirect } from 'next/navigation';

// Helpers d'autorisation par rôle (chantier 5, hiérarchie V2 : ADR-019 ;
// fusion equipier+parent → membre : spec 2026-06-17).
//
// La sidebar masque déjà les liens non pertinents, mais un user peut taper
// une URL : ces helpers protègent les pages côté serveur en redirigeant si
// le rôle ne matche pas. Le filtrage scope unité (chef) reste au niveau des
// services.

export const ADMIN_ROLES = ['tresorier', 'RG'] as const;
export const COMPTA_ROLES = ['tresorier', 'RG', 'chef'] as const;
// Camps : chef (sa seule unité, filtré côté service) + admin (tous).
export const CAMPS_ROLES = ['tresorier', 'RG', 'chef'] as const;
// Process (dépôt / remboursement / abandon). `membre` = rôle unifié.
// `equipier`/`parent` restent tolérés comme alias le temps que la migration
// BDD ait tourné partout (anti lock-out au cold start).
export const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'membre', 'equipier', 'parent'] as const;

export function requireRole(currentRole: string, allowedRoles: readonly string[]): void {
  if (!allowedRoles.includes(currentRole)) {
    redirect('/');
  }
}

// `tresorier` ou `RG` : accès complet à l'admin.
export function requireAdmin(currentRole: string): void {
  requireRole(currentRole, ADMIN_ROLES);
}

// `tresorier`, `RG` ou `chef` : pages de compta (filtre scope unité appliqué
// au niveau des services pour `chef`). Posé aussi sur /ecritures.
export function requireComptaAccess(currentRole: string): void {
  requireRole(currentRole, COMPTA_ROLES);
}

// `tresorier`, `RG`, `chef` : accès aux camps (le service filtre le chef sur
// sa seule unité). Le membre n'a PAS accès aux camps.
export function requireCampsAccess(currentRole: string): void {
  requireRole(currentRole, CAMPS_ROLES);
}

// Peut soumettre (justifs, demandes de remboursement, abandons) :
// tresorier, RG, chef, membre.
export function requireCanSubmit(currentRole: string): void {
  requireRole(currentRole, SUBMIT_ROLES);
}
