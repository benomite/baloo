import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Amount } from '@/components/shared/amount';

// Bandeau financier en tête de la vue Écritures. Présentation pure :
// reçoit les centimes en props (calculés côté serveur). Global, pas
// filter-aware (cf. plan étape 2).
export function EcrituresFinancialHeader({
  soldeExerciceCents,
  exercice,
  entreesExerciceCents,
  sortiesExerciceCents,
}: {
  soldeExerciceCents: number;
  exercice: string;
  entreesExerciceCents: number;
  sortiesExerciceCents: number;
}) {
  return (
    <div className="mb-6 rounded-xl border border-border-soft bg-bg-elevated px-5 py-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-fg-subtle font-medium">
          Solde de l&apos;exercice {exercice}
        </div>
        <div className="mt-1 font-display text-[26px] leading-none text-fg">
          <Amount cents={soldeExerciceCents} tone="signed" />
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center size-7 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30">
            <ArrowUpRight size={15} strokeWidth={2.25} />
          </span>
          <div>
            <div className="text-[11px] text-fg-subtle">Entrées de l&apos;exercice</div>
            <div className="font-semibold tabular-nums text-fg">
              <Amount cents={entreesExerciceCents} tone="positive" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center size-7 rounded-full bg-red-50 text-red-600 dark:bg-red-950/30">
            <ArrowDownRight size={15} strokeWidth={2.25} />
          </span>
          <div>
            <div className="text-[11px] text-fg-subtle">Sorties de l&apos;exercice</div>
            <div className="font-semibold tabular-nums text-fg">
              <Amount cents={sortiesExerciceCents} tone="negative" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
