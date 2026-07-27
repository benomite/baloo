// Garde pure A2 : conversion en dépôt réservée au trésorier, avant toute
// validation (statut a_traiter). Séparée de l'action pour être testable et
// pour ne pas être exposée comme server action.
export function canConvertRemboursement(role: string, status: string): boolean {
  return role === 'tresorier' && status === 'a_traiter';
}
