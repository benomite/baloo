'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SyncResult {
  status: string;
  updated_mirror: number;
  imported_from_cw: number;
  promoted_to_mirror: number;
  supprimee_cw_detected: number;
  link_suggestions_created: number;
  detail_fetches: number;
  error_message?: string;
}

/**
 * Lance une réconciliation sur TOUT l'exercice (scope='exercice', force).
 * Plus lourd que la sync « récente » automatique (relit le détail des
 * écritures non encore enrichies) — d'où le bouton manuel dédié.
 */
export function FullResyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const t = toast.loading('Réconciliation de tout l’exercice en cours…');
    try {
      const res = await fetch('/api/sync/run?force=1&scope=exercice', { method: 'POST' });
      const data = (await res.json()) as SyncResult;
      if (res.status === 429) {
        toast.info('Une synchronisation est déjà en cours.', { id: t });
        return;
      }
      if (!res.ok || data.status === 'failed') {
        toast.error(`Échec : ${data.error_message ?? 'erreur réconciliation'}`, { id: t });
        return;
      }
      toast.success(
        `Réconciliation OK — ${data.updated_mirror} maj, ${data.imported_from_cw} importées, ` +
          `${data.promoted_to_mirror} reliées, ${data.supprimee_cw_detected} supprimées, ` +
          `${data.link_suggestions_created} liens à confirmer.`,
        { id: t },
      );
      router.refresh();
    } catch {
      toast.error('Réconciliation interrompue (délai dépassé ?). Réessaie.', { id: t });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" disabled={running} onClick={run}>
      <RefreshCw size={14} className={running ? 'mr-1.5 animate-spin' : 'mr-1.5'} />
      {running ? 'Resync…' : 'Tout resynchroniser'}
    </Button>
  );
}
