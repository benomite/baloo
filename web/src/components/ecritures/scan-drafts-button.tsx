'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { scanDraftsFromComptaweb } from '@/lib/actions/drafts';

export function ScanDraftsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await scanDraftsFromComptaweb();
          if (result.erreur) {
            toast.error(`Scan échoué : ${result.erreur}`);
            return;
          }
          if (result.crees === 0 && result.existants === 0) {
            toast.info('Aucune ligne bancaire non rapprochée côté Comptaweb.');
            return;
          }
          toast.success(
            `Scan : ${result.crees} nouveau${result.crees > 1 ? 'x' : ''} draft${result.crees > 1 ? 's' : ''}, ${result.existants} déjà présent${result.existants > 1 ? 's' : ''}.`,
          );
        })
      }
    >
      {pending ? 'Scan en cours...' : 'Scanner Comptaweb'}
    </Button>
  );
}
