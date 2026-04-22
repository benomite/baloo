'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncReferentielsFromComptaweb } from '@/lib/actions/referentiels';
import type { RefSyncStats } from '@/lib/comptaweb';

function summarise(label: string, s: RefSyncStats): string {
  const parts: string[] = [];
  if (s.ajoutees) parts.push(`+${s.ajoutees}`);
  if (s.mappees) parts.push(`${s.mappees} mappée${s.mappees > 1 ? 's' : ''}`);
  if (s.orphelines.length) parts.push(`${s.orphelines.length} orph.`);
  return parts.length ? `${label}: ${parts.join(', ')}` : `${label}: à jour`;
}

export function SyncReferentielsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await syncReferentielsFromComptaweb();
          if (!result.ok || !result.report) {
            toast.error(`Sync échouée : ${result.erreur ?? 'erreur inconnue'}`);
            return;
          }
          const r = result.report;
          const lines = [
            summarise('Branches', r.unites),
            summarise('Natures', r.categories),
            summarise('Activités', r.activites),
            summarise('Modes', r.modes_paiement),
          ];
          const hasChanges =
            r.unites.ajoutees + r.unites.mappees +
              r.categories.ajoutees + r.categories.mappees +
              r.activites.ajoutees + r.activites.mappees +
              r.modes_paiement.ajoutees + r.modes_paiement.mappees >
            0;
          if (hasChanges) {
            toast.success('Référentiels synchronisés', { description: lines.join(' · ') });
          } else {
            toast.info('Référentiels déjà à jour', { description: lines.join(' · ') });
          }
        })
      }
    >
      {pending ? 'Synchronisation…' : 'Synchroniser les configs'}
    </Button>
  );
}
