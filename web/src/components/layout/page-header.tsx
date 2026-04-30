import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Lien de retour / catégorie parente, type "Écritures" → "/ecritures". */
  eyebrow?: { label: string; href: string };
  /** Titre principal. Bascule auto en sans-serif si long ou en CAPS. */
  title: string;
  /** Sous-titre / meta line en sans-serif neutre, sous le titre. */
  subtitle?: React.ReactNode;
  /** Bloc à droite du titre (status badge + montant typiquement). */
  meta?: React.ReactNode;
  /** Barre d'actions, sous le titre. */
  actions?: React.ReactNode;
  /** @deprecated alias de `actions` pour rétrocompat — préfère `actions`. */
  children?: React.ReactNode;
  /** Force la police sans-serif (utile si on connait le titre long). */
  forceSans?: boolean;
}

// Heuristique de bascule : on n'utilise la `font-display` (Bricolage)
// que sur des titres COURTS et bas-de-casse. Les libellés bancaires
// bruts (long + caps + symboles) sont illisibles en serif/grotesque
// expressive — fallback Geist sans-serif.
function shouldUseSansSerif(title: string): boolean {
  if (title.length > 48) return true;
  // Au moins 5 lettres consécutives en CAPS = libellé technique.
  if (/[A-Z]{5,}/.test(title)) return true;
  return false;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  children,
  forceSans,
}: PageHeaderProps) {
  const useSans = forceSans || shouldUseSansSerif(title);
  const actionContent = actions ?? children;

  return (
    <header className="border-b border-border-soft pb-5 sm:pb-6 mb-6 sm:mb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-8">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <Link
              href={eyebrow.href}
              className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted hover:text-fg transition-colors mb-2"
            >
              <ChevronLeft size={11} strokeWidth={2.5} />
              <span>{eyebrow.label}</span>
            </Link>
          )}
          <h1
            className={cn(
              'text-fg tracking-tight',
              useSans
                ? 'text-[20px] sm:text-[22px] font-semibold leading-[1.2] break-words'
                : 'font-display text-[24px] sm:text-[28px] font-medium leading-[1.08]',
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[13.5px] text-fg-muted leading-relaxed max-w-3xl">
              {subtitle}
            </p>
          )}
        </div>
        {meta && (
          <div className="shrink-0 flex items-center gap-3 sm:pt-1 flex-wrap">{meta}</div>
        )}
      </div>
      {actionContent && (
        <div className="mt-4 sm:mt-5 flex flex-wrap items-center gap-2">{actionContent}</div>
      )}
    </header>
  );
}
