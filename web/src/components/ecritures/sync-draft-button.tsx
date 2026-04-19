'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncDraftToComptaweb } from '@/lib/actions/drafts';

export function SyncDraftButton({ ecritureId }: { ecritureId: string }) {
  const [pending, startTransition] = useTransition();

  async function preview() {
    const res = await syncDraftToComptaweb(ecritureId, { dryRun: true });
    if (res.ok) toast.success(res.message);
    else if (res.missingFields?.length) toast.warning(res.message);
    else toast.error(res.message);
    return res.ok;
  }

  async function confirmAndSync() {
    if (!window.confirm('Créer cette écriture dans Comptaweb maintenant ? Action irréversible côté Comptaweb (il faudra supprimer manuellement si erreur).')) return;
    const res = await syncDraftToComptaweb(ecritureId, { dryRun: false });
    if (res.ok) toast.success(res.message);
    else toast.error(res.message);
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => { await preview(); })}
      >
        Prévisualiser sync Comptaweb
      </Button>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => startTransition(async () => { await confirmAndSync(); })}
      >
        Synchroniser Comptaweb
      </Button>
    </div>
  );
}
