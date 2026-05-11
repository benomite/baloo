'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/shared/section';
import { UnitesGrid } from './unites-grid';
import { RepartitionDrawer } from './repartition-drawer';
import type { UniteCardData } from './unite-card';
import type { Unite } from '@/lib/types';

interface Props {
  unites: UniteCardData[];
  exerciceParam: string;
  saison: string;
  unitesRef: Unite[];         // pour les selects de la modale
  canCreate: boolean;
}

export function UnitesSection({ unites, exerciceParam, saison, unitesRef, canCreate }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <Section
        title="Par unité"
        subtitle="Cliquez sur une unité pour voir le détail des dépenses et de la répartition par catégorie."
        className="mb-8"
        action={
          canCreate ? (
            <Button size="sm" onClick={() => setDrawerOpen(true)}>
              <Plus size={14} />
              Répartir
            </Button>
          ) : undefined
        }
      >
        <UnitesGrid unites={unites} exerciceParam={exerciceParam} />
      </Section>
      <RepartitionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        unites={unitesRef}
        saison={saison}
      />
    </>
  );
}
