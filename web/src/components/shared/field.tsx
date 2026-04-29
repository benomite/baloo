import { cn } from '@/lib/utils';

// `<Field>` : couple label + value pour les blocs d'attributs (page
// détail rembs / écriture / dépôt). Standardise le rendu (label muted
// xs, value medium) et évite la répétition de `<strong>Label :</strong>
// {value}` ou `<dt>/dt><dd>...` ad hoc.
//
// `value` est `ReactNode` pour pouvoir y mettre directement un
// `<Amount/>`, un lien, un badge, etc.

interface FieldProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function Field({ label, value, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
