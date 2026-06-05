import { ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';
import { Amount } from '@/components/shared/amount';

// Bandeau financier en tête de la vue Écritures. Présentation pure :
// reçoit les centimes en props (calculés côté serveur). Global, pas
// filter-aware (cf. plan étape 2).
//
// « Résultat » = recettes − dépenses HORS catégories de transfert (dépôts
// d'espèces, flux entre structures) : sinon un transfert neutre en trésorerie
// gonfle une fausse perte (cf. analyse 2026-06-05). Le solde caisse est
// affiché à part (table distincte, pas dans le résultat).
export function EcrituresFinancialHeader({
  resultatExerciceCents,
  exercice,
  entreesExerciceCents,
  sortiesExerciceCents,
  soldeCaisseCents,
}: {
  resultatExerciceCents: number;
  exercice: string;
  entreesExerciceCents: number;
  sortiesExerciceCents: number;
  soldeCaisseCents: number;
}) {
  return (
    <div className="mb-6 rounded-xl border border-border-soft bg-bg-elevated px-5 py-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-fg-subtle font-medium">
          Résultat de l&apos;exercice {exercice}
        </div>
        <div className="mt-1 font-display text-[26px] leading-none text-fg">
          <Amount cents={resultatExerciceCents} tone="signed" />
        </div>
        <div className="mt-1 text-[10.5px] text-fg-subtle">hors flux internes (dépôts espèces, transferts)</div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Stat
          icon={<ArrowUpRight size={15} strokeWidth={2.25} />}
          iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30"
          label="Entrées de l'exercice"
        >
          <Amount cents={entreesExerciceCents} tone="positive" />
        </Stat>
        <Stat
          icon={<ArrowDownRight size={15} strokeWidth={2.25} />}
          iconClass="bg-red-50 text-red-600 dark:bg-red-950/30"
          label="Sorties de l'exercice"
        >
          <Amount cents={sortiesExerciceCents} tone="negative" />
        </Stat>
        <div className="hidden sm:block self-stretch w-px bg-border-soft" aria-hidden />
        <Stat
          icon={<Wallet size={15} strokeWidth={2.25} />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/30"
          label="Solde en caisse (espèces)"
        >
          <Amount cents={soldeCaisseCents} tone="signed" />
        </Stat>
      </div>
    </div>
  );
}

function Stat({
  icon,
  iconClass,
  label,
  children,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center justify-center size-7 rounded-full ${iconClass}`}>
        {icon}
      </span>
      <div>
        <div className="text-[11px] text-fg-subtle">{label}</div>
        <div className="font-semibold tabular-nums text-fg">{children}</div>
      </div>
    </div>
  );
}
