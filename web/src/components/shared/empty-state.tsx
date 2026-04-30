import { cn } from '@/lib/utils';

// `<EmptyState>` : remplace les `<p className="text-muted-foreground">
// Aucun X.</p>` mornes dispersés. Plus chaleureux : un emoji ou icône,
// un titre, une description, et un CTA optionnel. À utiliser dans les
// listes vides (rembs, abandons, caisse, dépôts, écritures filtrées).

interface EmptyStateProps {
  emoji?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ emoji, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center',
        className,
      )}
    >
      {emoji && (
        <div className="text-4xl mb-2" aria-hidden>
          {emoji}
        </div>
      )}
      <h3 className="font-medium text-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
