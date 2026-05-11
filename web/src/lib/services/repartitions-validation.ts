export interface RepartitionValidationInput {
  date_repartition: string;        // YYYY-MM-DD
  saison: string;                  // YYYY-YYYY (ex. 2025-2026)
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
}

// Valide un input de création/édition de répartition. Retourne un message
// d'erreur explicite si invalide, null si OK. Pas de dépendance BDD —
// testable en pur vitest.
export function validateRepartitionInput(input: RepartitionValidationInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date_repartition)) {
    return 'Date invalide (attendu YYYY-MM-DD).';
  }
  if (!/^\d{4}-\d{4}$/.test(input.saison)) {
    return 'Saison invalide (attendu YYYY-YYYY).';
  }
  if (!Number.isInteger(input.montant_cents) || input.montant_cents <= 0) {
    return 'Montant invalide (attendu un entier strictement positif).';
  }
  if (input.unite_source_id === null && input.unite_cible_id === null) {
    return "Une répartition Groupe → Groupe n'a pas de sens (source et cible sont identiques).";
  }
  if (input.unite_source_id !== null && input.unite_source_id === input.unite_cible_id) {
    return "Une répartition d'une unité vers elle-même n'a pas de sens (source = cible).";
  }
  if (input.libelle.trim().length === 0) {
    return 'Libellé requis.';
  }
  return null;
}
