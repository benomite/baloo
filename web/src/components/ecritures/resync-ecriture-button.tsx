'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { resyncEcritureDepuisCw } from '@/lib/actions/ecritures';

/**
 * Resync ciblé d'une écriture déjà reliée à Comptaweb : relit sa page
 * détail et réaligne activité / unité / catégorie. Utile pour réparer une
 * écriture précise (notamment ancienne, hors fenêtre du cycle « récent »)
 * sans lancer une réconciliation complète.
 */
export function ResyncEcritureButton({ ecritureId }: { ecritureId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await resyncEcritureDepuisCw(ecritureId);
          if (res.ok) {
            toast.success('Écriture resynchronisée depuis Comptaweb.');
            router.refresh();
          } else {
            toast.error(res.message ?? 'Resync impossible.');
          }
        })
      }
    >
      <RefreshCw size={13} className="mr-1" />
      {pending ? 'Resync…' : 'Resync Comptaweb'}
    </Button>
  );
}
