'use client';

import type { ReactNode } from 'react';
import { Landmark, Lock, CheckCircle2, AlertTriangle, Circle, X } from 'lucide-react';
import { InlineText } from '@/components/shared/inline-text';
import { Amount } from '@/components/shared/amount';
import type { Ecriture } from '@/lib/types';
import type { PanelViewModel } from './panel-view-model';
import type { computeReadiness } from '@/lib/sync-readiness';

// Header compact du panneau : titre (éditable si brouillon, avec le nudge
// « titre parlant »), montant + date, puce d'état, origine banque condensée,
// slot menu ⋯ et bouton fermer. Remplace l'ancien empilement header + gros
// bandeau readiness + bandeau origine banque.

const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
function dateCourte(iso: string): string {
  const j = iso.slice(8, 10);
  const m = parseInt(iso.slice(5, 7), 10);
  return `${j} ${MOIS[m - 1] ?? ''}`;
}

export function StateChip({ readiness }: { readiness: ReturnType<typeof computeReadiness> }) {
  if (readiness.level === 'synced') {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-300">
        <Lock size={12} strokeWidth={2.25} /> Synchro CW
      </span>
    );
  }
  if (readiness.level === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 size={12} strokeWidth={2.25} /> Prête
      </span>
    );
  }
  // incomplete
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700 dark:text-amber-300">
      <AlertTriangle size={12} strokeWidth={2.25} />
      À compléter
    </span>
  );
}

// Statut condensé du panneau, désormais rendu dans le FOOTER (bande basse) :
// puce d'état (readiness) + origine banque + rappel CW. Extrait de l'ancien
// bas d'en-tête pour laisser le haut minimal.
export function PanelStatus({
  ecriture,
  readiness,
}: {
  ecriture: Ecriture;
  readiness: ReturnType<typeof computeReadiness>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-fg-subtle">
      <StateChip readiness={readiness} />
      {ecriture.ligne_bancaire_id && (
        <span className="inline-flex items-center gap-1">
          <Circle size={3} className="fill-current" />
          <Landmark size={11} className="shrink-0" />
          banque <code className="font-mono">#{ecriture.ligne_bancaire_id}</code>
          {ecriture.ligne_bancaire_sous_index !== null && <span>· sous-ligne {ecriture.ligne_bancaire_sous_index}</span>}
        </span>
      )}
      {ecriture.comptaweb_ecriture_id != null && (
        <span className="inline-flex items-center gap-1">
          <Circle size={3} className="fill-current" />
          CW <code className="font-mono">{ecriture.comptaweb_ecriture_id}</code>
        </span>
      )}
    </div>
  );
}

export function PanelHeader({
  ecriture,
  vm,
  pinned,
  onRename,
  onCollapse,
  menu,
}: {
  ecriture: Ecriture;
  vm: PanelViewModel;
  // Épinglé = panneau autonome (pas de ligne au-dessus) → on répète
  // titre/date/montant. En mode inline (sous une ligne), la ligne les porte
  // déjà : l'en-tête se réduit au bouton fermer.
  pinned: boolean;
  onRename: (value: string) => Promise<{ ok: boolean; message?: string }>;
  onCollapse: () => void;
  menu?: ReactNode;
}) {
  const closeButton = (
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Replier"
      className="shrink-0 inline-flex items-center justify-center size-6 rounded text-fg-subtle hover:bg-muted hover:text-fg transition-colors"
    >
      <X size={15} strokeWidth={2} />
    </button>
  );

  // Mode inline : la ligne porte déjà titre/date/montant → en-tête minimal.
  if (!pinned) {
    return (
      <div className="mb-2 flex items-center justify-end gap-2">
        {menu}
        {closeButton}
      </div>
    );
  }

  const titleNode = vm.editable ? (
    <InlineText
      value={ecriture.description}
      onSave={onRename}
      title={ecriture.titre_a_renommer ? 'Libellé bancaire brut — clique pour préciser (part dans Comptaweb)' : 'Cliquer pour renommer'}
      display={
        ecriture.titre_a_renommer ? (
          <span className="inline-flex items-center gap-1 min-w-0 text-[14px] italic text-fg-subtle">
            <span className="truncate">{ecriture.description}</span>
          </span>
        ) : (
          <span className="block truncate font-semibold text-[14px] text-fg hover:underline">{ecriture.description}</span>
        )
      }
    />
  ) : (
    <span className="block truncate font-semibold text-[14px] text-fg" title={ecriture.description}>
      {ecriture.description}
    </span>
  );

  return (
    <div className="mb-3 pb-3 border-b border-border-soft">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{titleNode}</div>
        <div className="shrink-0 text-right">
          <Amount
            cents={ecriture.amount_cents}
            tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
            className="text-[15px] font-semibold tabular-nums"
          />
          <div className="text-[11px] text-fg-subtle tabular-nums">{dateCourte(ecriture.date_ecriture)}</div>
        </div>
        {menu}
        {closeButton}
      </div>
    </div>
  );
}
