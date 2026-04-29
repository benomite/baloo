import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// `<Alert>` : bandeau d'info / succès / erreur. Remplace les blocs
// répétés `bg-red-50 border border-red-200 rounded px-3 py-2` etc.
// dispersés dans presque toutes les pages.
//
// Utilisation typique avec un searchParam d'erreur :
//   {sp.error && <Alert variant="error">{sp.error}</Alert>}

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface AlertProps {
  variant?: AlertVariant;
  icon?: LucideIcon | null;
  className?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100',
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100',
};

const VARIANT_DEFAULT_ICON: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function Alert({ variant = 'info', icon, className, children }: AlertProps) {
  const Icon = icon === null ? null : icon ?? VARIANT_DEFAULT_ICON[variant];
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        VARIANT_CLASSES[variant],
        className,
      )}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
    >
      {Icon && <Icon size={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
