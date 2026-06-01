// Logique de matching écriture ↔ justif de l'inbox. Module **pur** (pas
// d'I/O, pas de contexte/auth) — extrait de `queries/inbox.ts` pour être
// testable sans la stack serveur, et partagé avec `services/inbox-rejets`
// + `services/inbox-auto`.

export interface InboxEcriture {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  unite_code: string | null;
  comptaweb_synced: 0 | 1;
}

export interface InboxJustif {
  id: string;
  titre: string;
  description: string | null;
  amount_cents: number | null;
  date_estimee: string | null;
  unite_code: string | null;
  category_name: string | null;
  submitter_name: string | null;
  submitter_email: string;
  justif_path: string | null;
  created_at: string;
}

export interface InboxSuggestion {
  ecriture: InboxEcriture;
  justif: InboxJustif;
  date_diff_days: number;
  amount_diff_cents: number;
}

// Seuils des suggestions auto (doivent rester serrés pour éviter les
// faux positifs : un seul mauvais auto-match coûte plus cher en perte
// de confiance qu'un manuel évité).
const AUTO_AMOUNT_TOLERANCE_RATIO = 0.02; // 2 %
const AUTO_AMOUNT_TOLERANCE_FLOOR_CENTS = 100; // 1 €
const AUTO_DATE_TOLERANCE_DAYS = 3;

// Clé stable d'une paire (écriture, dépôt) pour les Set en mémoire —
// notamment les paires rejetées par le trésorier.
export function rejetPairKey(ecritureId: string, depotId: string): string {
  return `${ecritureId}::${depotId}`;
}

// Heuristique gloutonne : pour chaque écriture, on prend le justif libre
// qui matche le mieux (montant ±tol, date ±3j). Pas de scoring
// sophistiqué, juste un seuil serré. Les paires de `rejectedPairs`
// (rejetées explicitement par le trésorier) ne sont jamais proposées.
export function computeAutoSuggestions(
  ecritures: InboxEcriture[],
  justifs: InboxJustif[],
  rejectedPairs: Set<string> = new Set(),
): InboxSuggestion[] {
  const out: InboxSuggestion[] = [];
  const used = new Set<string>();

  for (const ecr of ecritures) {
    const eAmount = Math.abs(ecr.amount_cents);
    const tol = Math.max(
      AUTO_AMOUNT_TOLERANCE_FLOOR_CENTS,
      Math.round(eAmount * AUTO_AMOUNT_TOLERANCE_RATIO),
    );
    let best: { justif: InboxJustif; amountDiff: number; dateDiff: number } | null = null;
    for (const j of justifs) {
      if (used.has(j.id)) continue;
      // Paire explicitement rejetée par le trésorier : on ne la
      // re-propose plus jamais.
      if (rejectedPairs.has(rejetPairKey(ecr.id, j.id))) continue;
      if (j.amount_cents == null || j.date_estimee == null) continue;
      const jAmount = Math.abs(j.amount_cents);
      const amountDiff = Math.abs(eAmount - jAmount);
      if (amountDiff > tol) continue;
      const dateDiff = daysBetween(ecr.date_ecriture, j.date_estimee);
      if (dateDiff > AUTO_DATE_TOLERANCE_DAYS) continue;
      if (
        best === null ||
        amountDiff < best.amountDiff ||
        (amountDiff === best.amountDiff && dateDiff < best.dateDiff)
      ) {
        best = { justif: j, amountDiff, dateDiff };
      }
    }
    if (best) {
      used.add(best.justif.id);
      out.push({
        ecriture: ecr,
        justif: best.justif,
        amount_diff_cents: best.amountDiff,
        date_diff_days: best.dateDiff,
      });
    }
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
