import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// `<StatCard>` : KPI compact, style Pennylane / Stripe Dashboard.
// Card plate (border, pas d'ombre), title en uppercase muted, valeur
// en display font. Sub-label optionnel pour un complément (compteur,
// delta, etc.) — typiquement texte muted petit.
//
// `value` est laissé en ReactNode pour qu'on y mette directement un
// `<Amount/>`, un nombre, du texte, ou une combinaison.

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export function StatCard({ label, value, sublabel, icon: Icon, className }: StatCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card px-5 py-4 flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon size={14} className="text-muted-foreground shrink-0" />}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sublabel && (
        <div className="text-xs text-muted-foreground tabular-nums">{sublabel}</div>
      )}
    </div>
  );
}
