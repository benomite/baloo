'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EcritureInlinePanel } from './ecriture-inline-panel';
import type { Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

// Panneau épinglé en haut de la liste quand on arrive via un lien profond
// (`/ecritures?open=<id>`), y compris si l'écriture n'est pas dans la page
// chargée (pagination). Autonome : le panneau charge lui-même son détail par
// id. Remplace l'ancienne page détail `/ecritures/[id]` (qui redirige ici).

export function PinnedEcriturePanel({
  ecritureId,
  isAdmin,
  categories,
  topCategoryIds,
  unites,
  modesPaiement,
  activites,
  cartes,
}: {
  ecritureId: string;
  isAdmin: boolean;
  categories: Category[];
  topCategoryIds: string[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
  cartes: Carte[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reload, setReload] = useState(0);

  const close = () => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('open');
    const qs = sp.toString();
    router.replace(qs ? `/ecritures?${qs}` : '/ecritures');
  };

  return (
    <div className="mb-4">
      <EcritureInlinePanel
        ecritureId={ecritureId}
        isAdmin={isAdmin}
        reloadSignal={reload}
        refreshRow={() => setReload((n) => n + 1)}
        onCollapse={close}
        categories={categories}
        topCategoryIds={topCategoryIds}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
      />
    </div>
  );
}
