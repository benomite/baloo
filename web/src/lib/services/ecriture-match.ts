// Matching « cette écriture sans justif ↔ un dépôt à traiter / un remboursement
// actif ». Pur (pas de DB) : la page charge les pools une fois, le tableau
// matche en mémoire par ligne. Tolérance alignée sur le matching dépôts
// existant (depots.ts) : montant ±10% (plancher 1€), date ±15 jours.

export interface MatchDepot {
  id: string;
  amount_cents: number | null;
  date_estimee: string | null;
  titre: string;
}
export interface MatchRemboursement {
  id: string;
  total_cents: number;
  date_depense: string | null;
  demandeur: string;
}
export type EcritureMatch =
  | { kind: 'depot'; id: string; label: string }
  | { kind: 'remboursement'; id: string; label: string };

const DATE_TOL_DAYS = 15;

function amountMatches(a: number, b: number): boolean {
  const tol = Math.max(100, Math.round(Math.abs(a) * 0.1));
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function suggestMatchForEcriture(
  ecriture: { amount_cents: number; date_ecriture: string },
  depots: MatchDepot[],
  rembs: MatchRemboursement[],
): EcritureMatch | null {
  let best: { match: EcritureMatch; dist: number; pref: number } | null = null;
  const consider = (match: EcritureMatch, dist: number, pref: number) => {
    if (!best || dist < best.dist || (dist === best.dist && pref < best.pref)) {
      best = { match, dist, pref };
    }
  };

  for (const d of depots) {
    if (d.amount_cents == null || d.date_estimee == null) continue;
    if (!amountMatches(ecriture.amount_cents, d.amount_cents)) continue;
    const dist = dayDiff(ecriture.date_ecriture, d.date_estimee);
    if (dist > DATE_TOL_DAYS) continue;
    consider({ kind: 'depot', id: d.id, label: d.titre }, dist, 0);
  }
  for (const r of rembs) {
    if (r.date_depense == null) continue;
    if (!amountMatches(ecriture.amount_cents, r.total_cents)) continue;
    const dist = dayDiff(ecriture.date_ecriture, r.date_depense);
    if (dist > DATE_TOL_DAYS) continue;
    consider({ kind: 'remboursement', id: r.id, label: r.demandeur }, dist, 1);
  }

  return best ? best.match : null;
}
