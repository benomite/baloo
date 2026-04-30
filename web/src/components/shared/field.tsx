import { cn } from '@/lib/utils';

// `<Field>` : wrapper standardisé pour un champ de formulaire.
// Label uppercase XS muted (style Linear / Pennylane), espacement fixe
// label-input, support hint et error.
//
// Pour les blocs read-only (page détail), utilise plutôt `<DataField>`
// — même look général mais sans interactivité.

interface FieldProps {
  label: React.ReactNode;
  /** Aide affichée à droite du label (ex: format attendu). */
  hint?: React.ReactNode;
  /** Message d'erreur sous le champ (rouge). */
  error?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium text-fg flex items-baseline gap-1"
        >
          <span>{label}</span>
          {required && <span className="text-destructive">*</span>}
        </label>
        {hint && !error && (
          <span className="text-[11.5px] text-fg-subtle">{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="text-[12px] text-destructive">{error}</p>
      )}
    </div>
  );
}

// Variante read-only : couple label/value pour les pages détail.
interface DataFieldProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function DataField({ label, value, className }: DataFieldProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        {label}
      </dt>
      <dd className="text-[13.5px] font-medium text-fg">{value}</dd>
    </div>
  );
}
