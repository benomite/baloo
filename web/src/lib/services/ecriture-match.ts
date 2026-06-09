// Matching « cette écriture sans justif ↔ un dépôt à traiter / un remboursement
// actif ». Pur (pas de DB) : la page charge les pools une fois, le tableau
// matche en mémoire par ligne. Tolérance alignée sur le matching dépôts
// existant (depots.ts) : montant ±10% (plancher 1€), date ±15 jours.
//
// Les paires explicitement rejetées par le trésorier (« ne plus proposer »)
// sont exclues : on réutilise le même registre que l'inbox
// (`inbox_suggestion_rejets` + `rejetPairKey`).

import { rejetPairKey } from '../queries/inbox-matching';

export interface MatchDepot {
  id: string;
  amount_cents: number | null;
  date_estimee: string | null;
  titre: string;
  uniteCode: string | null;
  categoryName: string | null;
}
export interface MatchRemboursement {
  id: string;
  total_cents: number;
  date_depense: string | null;
  // Date du virement : c'est elle qui correspond à l'écriture bancaire du
  // remboursement (date_depense est la date de la dépense d'origine, souvent
  // bien antérieure). On matche sur date_paiement ?? date_depense.
  date_paiement: string | null;
  demandeur: string;
  uniteCode: string | null;
  status: string;
}
export interface EcritureMatch {
  kind: 'depot' | 'remboursement';
  id: string;
  label: string;
  amountCents: number | null;
  date: string | null;
  uniteCode: string | null;
  detail: string | null;
}

const DATE_TOL_DAYS = 15;

function amountMatches(a: number, b: number): boolean {
  const tol = Math.max(100, Math.round(Math.abs(a) * 0.1));
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function suggestMatchForEcriture(
  ecriture: { id: string; amount_cents: number; date_ecriture: string },
  depots: MatchDepot[],
  rembs: MatchRemboursement[],
  rejectedKeys: Set<string> = new Set(),
): EcritureMatch | null {
  // Collecte puis tri (pas de mutation dans une closure : TS ne sait pas
  // suivre l'affectation capturée et réduit la variable à `never`).
  // pref : 0 = dépôt, 1 = remboursement → à égalité de date, le dépôt gagne.
  const candidates: { match: EcritureMatch; dist: number; pref: number }[] = [];

  for (const d of depots) {
    if (d.amount_cents == null || d.date_estimee == null) continue;
    if (rejectedKeys.has(rejetPairKey(ecriture.id, 'depot', d.id))) continue;
    if (!amountMatches(ecriture.amount_cents, d.amount_cents)) continue;
    const dist = dayDiff(ecriture.date_ecriture, d.date_estimee);
    if (dist > DATE_TOL_DAYS) continue;
    candidates.push({
      match: { kind: 'depot', id: d.id, label: d.titre, amountCents: d.amount_cents, date: d.date_estimee, uniteCode: d.uniteCode, detail: d.categoryName },
      dist, pref: 0,
    });
  }
  for (const r of rembs) {
    // Date de référence = virement (date_paiement) sinon dépense — aligné
    // sur le matching de l'inbox (l'écriture est le virement bancaire).
    const refDate = r.date_paiement ?? r.date_depense;
    if (refDate == null) continue;
    if (rejectedKeys.has(rejetPairKey(ecriture.id, 'remboursement', r.id))) continue;
    if (!amountMatches(ecriture.amount_cents, r.total_cents)) continue;
    const dist = dayDiff(ecriture.date_ecriture, refDate);
    if (dist > DATE_TOL_DAYS) continue;
    candidates.push({
      match: { kind: 'remboursement', id: r.id, label: r.demandeur, amountCents: r.total_cents, date: refDate, uniteCode: r.uniteCode, detail: r.status },
      dist, pref: 1,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist || a.pref - b.pref);
  return candidates[0].match;
}
