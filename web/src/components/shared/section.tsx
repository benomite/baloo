import { cn } from '@/lib/utils';

// `<Section>` : carte de section pour les pages de détail / formulaires.
// Donne un titre h2 sans-serif (NB : pas de `font-display`, on évite
// la serif sur les sous-titres pour ne pas surcharger), un sous-titre
// muted optionnel, et un fond `bg-elevated` avec border.
//
// Pour des sections sans card (juste un titre + contenu), utilise
// `<SectionHeader>`.

interface SectionProps {
  title: string;
  subtitle?: React.ReactNode;
  /** Action(s) en haut à droite de la section (ex: bouton "Ajouter"). */
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function Section({ title, subtitle, action, className, bodyClassName, children }: SectionProps) {
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-bg-elevated overflow-hidden',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-fg">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] text-fg-muted">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn('px-6 pb-6 space-y-4', bodyClassName)}>{children}</div>
    </section>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4 mb-4', className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-fg">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
