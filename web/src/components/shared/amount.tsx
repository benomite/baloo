import { cn } from '@/lib/utils';

// Composant de rendu d'un montant en centimes. Utilisé partout pour
// que les montants soient cohérents :
//
//   - `tabular-nums`  : chiffres de largeur fixe (alignement propre en colonne)
//   - `slashed-zero`  : 0 distinguable du O dans la police
//   - séparateur de milliers : NBSP (`12 345,67 €`) — désactivable via `thousands={false}`
//   - NBSP avant le `€` (anti-coupure de ligne)
//
// Variantes de couleur :
//   - `default`  : foreground normal
//   - `muted`    : gris doux (`text-muted-foreground`) pour totaux secondaires
//   - `negative` : rouge, **force un préfixe `-`** même si cents > 0
//                  (utile pour afficher une dépense quand les cents sont
//                   stockés en valeur absolue avec un type='depense' à part)
//   - `positive` : vert, **force un préfixe `+`** (idem pour recette,
//                  symétrique avec `negative` pour la lisibilité)
//   - `signed`   : couleur déduite du signe des cents (rouge / vert / neutre)
//
// Note : ne wrap PAS dans une div alignée — laisse le parent décider
// (text-right sur la cellule de tableau, par ex.).

type AmountTone = 'default' | 'muted' | 'negative' | 'positive' | 'signed';

interface AmountProps {
  cents: number;
  tone?: AmountTone;
  thousands?: boolean;
  className?: string;
}

const TONE_CLASSES: Record<Exclude<AmountTone, 'signed'>, string> = {
  default: '',
  muted: 'text-muted-foreground',
  negative: 'text-red-600 dark:text-red-400',
  positive: 'text-emerald-600 dark:text-emerald-400',
};

const NBSP = ' ';

function formatForDisplay(cents: number, tone: AmountTone, thousands: boolean): string {
  // Pour `negative` / `positive`, on prend la valeur absolue puis on
  // décide nous-mêmes du préfixe — on respecte la sémantique souhaitée
  // par le caller, pas le signe brut des cents.
  const forceSign = tone === 'negative' ? '-' : tone === 'positive' ? '+' : '';
  const absCents = tone === 'negative' || tone === 'positive' ? Math.abs(cents) : cents;

  const sign = absCents < 0 ? '-' : forceSign;
  const abs = Math.abs(absCents);
  const euros = Math.floor(abs / 100);
  const cts = String(abs % 100).padStart(2, '0');
  const eurosStr = thousands
    ? String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
    : String(euros);
  return `${sign}${eurosStr},${cts}${NBSP}€`;
}

function resolvedTone(cents: number, tone: AmountTone): Exclude<AmountTone, 'signed'> {
  if (tone !== 'signed') return tone;
  if (cents > 0) return 'positive';
  if (cents < 0) return 'negative';
  return 'muted';
}

export function Amount({ cents, tone = 'default', thousands = true, className }: AmountProps) {
  const finalTone = resolvedTone(cents, tone);
  return (
    <span className={cn('tabular-nums slashed-zero whitespace-nowrap', TONE_CLASSES[finalTone], className)}>
      {formatForDisplay(cents, tone, thousands)}
    </span>
  );
}
