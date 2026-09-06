'use client';

import { useState, type ReactNode } from 'react';
import type { CampStatut } from '@/lib/services/camps';

// Onglets Dépenses / Recettes / Bilan de la vue camp. Les trois panneaux
// sont rendus côté serveur et passés en props ; on bascule l'affichage via
// `hidden` pour préserver l'état des éléments interactifs (ex. <details>
// du form avance).

type Tab = 'depenses' | 'recettes' | 'bilan';

const LABELS: Array<[Tab, string]> = [
  ['depenses', 'Dépenses'],
  ['recettes', 'Recettes'],
  ['bilan', 'Bilan'],
];

export function CampTabs({
  depenses,
  recettes,
  bilan,
  statut,
}: {
  depenses: ReactNode;
  recettes: ReactNode;
  bilan: ReactNode;
  statut?: CampStatut;
}) {
  // Camp clôturé : c'est le bilan qu'on vient regarder, pas le suivi.
  const [tab, setTab] = useState<Tab>(statut === 'cloture' ? 'bilan' : 'depenses');

  const panneaux: Record<Tab, ReactNode> = { depenses, recettes, bilan };

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-border mb-6">
        {LABELS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-brand text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {LABELS.map(([key]) => (
        <div key={key} className={tab === key ? '' : 'hidden'}>
          {panneaux[key]}
        </div>
      ))}
    </div>
  );
}
