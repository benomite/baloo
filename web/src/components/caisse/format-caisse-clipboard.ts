// Helper de formatage clipboard pour la double saisie caisse côté
// Comptaweb — Task 9 du pivot miroir strict + MCP-first.
//
// Doctrine : Comptaweb n'expose pas de scraping write pour les
// mouvements de caisse. La caisse Baloo reste donc une saisie purement
// locale, mais on aide à la double saisie côté CW en formattant le
// mouvement courant en texte lisible prêt à coller.
//
// Forme cible :
//   CAISSE — saisie à reporter dans Comptaweb
//   ------------------------------------------
//   Date     : 19/05/2026
//   Type     : Entrée d'espèces
//   Montant  : 50,00 €
//   Libellé  : Quête camp été
//   Unité    : rouges
//   Notes    : ...

export interface CaissePayload {
  /** ISO date `YYYY-MM-DD`. Peut être vide (form pas encore rempli). */
  date_mouvement: string;
  /** Montant en centimes — peut être négatif, sera traité en valeur absolue. */
  amount_cents: number;
  /** Sens du mouvement. `depot` n'est jamais saisi via cette UI (dépôt = autre form). */
  type: 'entree' | 'sortie';
  description: string;
  /** Libellé humain de l'unité (ex. "rouges") ou null si caisse groupe. */
  unite_label?: string | null;
  /** Libellé humain de l'activité (ex. "Camp été 2026") ou null. */
  activite_label?: string | null;
  notes?: string | null;
}

const TYPE_LABEL: Record<CaissePayload['type'], string> = {
  entree: "Entrée d'espèces",
  sortie: "Sortie d'espèces",
};

const FR_DATE = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const FR_AMOUNT = (cents: number): string =>
  (Math.abs(cents) / 100).toFixed(2).replace('.', ',');

export function formatCaisseForClipboard(p: CaissePayload): string {
  const lines: string[] = [
    'CAISSE — saisie à reporter dans Comptaweb',
    '------------------------------------------',
    `Date     : ${FR_DATE(p.date_mouvement)}`,
    `Type     : ${TYPE_LABEL[p.type]}`,
    `Montant  : ${FR_AMOUNT(p.amount_cents)} €`,
    `Libellé  : ${p.description}`,
  ];
  if (p.unite_label) lines.push(`Unité    : ${p.unite_label}`);
  if (p.activite_label) lines.push(`Activité : ${p.activite_label}`);
  if (p.notes) lines.push(`Notes    : ${p.notes}`);
  return lines.join('\n');
}
