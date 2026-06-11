// Logique pure des avances de tresorerie d'un camp (spec 2026-06-10, A2).
// Une avance versee a un chef est un TRANSFERT, pas une depense du camp :
// ce sont les tickets payes sur l'avance qui comptent (depots -> ecritures).
// Ici : validation de cloture (reliquat rendu) + resume pour l'affichage.

export type AvanceStatut = 'versee' | 'cloturee';

export interface AvanceLike {
  montant_cents: number;
  montant_rendu_cents: number | null;
  statut: AvanceStatut;
}

export interface AvancesSummary {
  totalVerseCents: number;
  enCirculationCents: number; // avances versees non cloturees
  totalRenduCents: number;
  consommeCents: number; // cloturees : verse - rendu
  enCoursCount: number;
}

export function validateCloture(
  montantCents: number,
  renduCents: number,
): string | null {
  if (!Number.isInteger(renduCents) || renduCents < 0) {
    return 'Montant rendu invalide.';
  }
  if (renduCents > montantCents) {
    return "Le montant rendu ne peut pas dépasser le montant de l'avance.";
  }
  return null;
}

export function buildAvancesSummary(avances: AvanceLike[]): AvancesSummary {
  const s: AvancesSummary = {
    totalVerseCents: 0,
    enCirculationCents: 0,
    totalRenduCents: 0,
    consommeCents: 0,
    enCoursCount: 0,
  };
  for (const a of avances) {
    s.totalVerseCents += a.montant_cents;
    if (a.statut === 'cloturee') {
      const rendu = a.montant_rendu_cents ?? 0;
      s.totalRenduCents += rendu;
      s.consommeCents += a.montant_cents - rendu;
    } else {
      s.enCirculationCents += a.montant_cents;
      s.enCoursCount += 1;
    }
  }
  return s;
}
