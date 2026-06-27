'use client';

import { useState } from 'react';

// Onglets Dépenses / Recettes de la vue camp. Les deux panneaux sont rendus
// côté serveur et passés en props ; on bascule l'affichage via `hidden` pour
// préserver l'état des éléments interactifs (ex. <details> du form avance).
export function CampTabs({
  depenses,
  recettes,
}: {
  depenses: React.ReactNode;
  recettes: React.ReactNode;
}) {
  const [tab, setTab] = useState<'depenses' | 'recettes'>('depenses');

  const tabClass = (active: boolean) =>
    `px-3 py-2 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
      active
        ? 'border-brand text-fg'
        : 'border-transparent text-fg-muted hover:text-fg'
    }`;

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-border mb-6">
        <button role="tab" type="button" aria-selected={tab === 'depenses'} onClick={() => setTab('depenses')} className={tabClass(tab === 'depenses')}>
          Dépenses
        </button>
        <button role="tab" type="button" aria-selected={tab === 'recettes'} onClick={() => setTab('recettes')} className={tabClass(tab === 'recettes')}>
          Recettes
        </button>
      </div>
      <div className={tab === 'depenses' ? '' : 'hidden'}>{depenses}</div>
      <div className={tab === 'recettes' ? '' : 'hidden'}>{recettes}</div>
    </div>
  );
}
