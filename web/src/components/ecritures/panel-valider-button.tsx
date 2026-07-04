'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncDraftToComptaweb } from '@/lib/actions/drafts';

// Bouton « Valider » unique du panneau = MATÉRIALISE l'écriture dans Comptaweb
// (comme le « Valider » de la ligne), pas un simple flag de statut. Deux
// chemins :
//  - onValidate fourni (panneau inline sous une ligne) → délègue au flux
//    optimiste du parent (verrou ligne + retrait au succès), cohérent avec la
//    ligne.
//  - sinon (panneau autonome/épinglé via ?open) → appelle directement la sync
//    puis referme au succès.
// Pas de window.confirm : décision terrain 29/06 (validation en série).
export function PanelValiderButton({
  ecritureId,
  disabled = false,
  missing = [],
  onValidate,
  onDone,
}: {
  ecritureId: string;
  disabled?: boolean;
  missing?: string[];
  onValidate?: (id: string) => void;
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const title = disabled ? `À compléter avant de valider : ${missing.join(', ')}` : 'Créer cette écriture dans Comptaweb';

  const click = () => {
    if (onValidate) {
      onValidate(ecritureId);
      return;
    }
    startTransition(async () => {
      try {
        const res = await syncDraftToComptaweb(ecritureId, { dryRun: false });
        if (res.ok) {
          toast.success(res.message);
          onDone?.();
        } else {
          toast.error(res.message);
        }
      } catch {
        toast.error('La validation a échoué (Comptaweb injoignable ?). Réessaie.');
      }
    });
  };

  return (
    <Button size="sm" disabled={disabled || pending} onClick={click} title={title}>
      Valider
    </Button>
  );
}
