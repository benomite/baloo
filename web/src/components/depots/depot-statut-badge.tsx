import { cn } from '@/lib/utils';

const STATUTS: Record<string, { label: string; className: string }> = {
  a_traiter: {
    label: 'à traiter',
    className: 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  },
  rattache: {
    label: 'rattaché',
    className: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  },
  rejete: {
    label: 'rejeté',
    className: 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200',
  },
};

export function DepotStatutBadge({ statut }: { statut: string }) {
  const s = STATUTS[statut] ?? { label: statut, className: 'bg-bg-sunken text-fg-muted' };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium shrink-0',
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}
