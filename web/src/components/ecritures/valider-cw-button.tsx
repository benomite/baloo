'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncDraftToComptaweb } from '@/lib/actions/drafts';

// CTA compact « Valider » d'une carte écriture en draft : crée l'écriture
// dans Comptaweb (irréversible → confirm). `disabled` quand l'écriture est
// incomplète (gate `computeReadiness` côté appelant) ; `missing` liste les
// champs manquants pour le tooltip.
export function ValiderCwButton({
  ecritureId,
  disabled = false,
  missing = [],
  onValidated,
}: {
  ecritureId: string;
  disabled?: boolean;
  missing?: string[];
  /** Appelé après une validation réussie : permet au parent de re-fetcher la
   *  ligne pour qu'elle migre vers le groupe des écritures validées. */
  onValidated?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () =>
    startTransition(async () => {
      if (
        !window.confirm(
          'Créer cette écriture dans Comptaweb maintenant ? Action irréversible côté Comptaweb (suppression manuelle si erreur).',
        )
      )
        return;
      const res = await syncDraftToComptaweb(ecritureId, { dryRun: false });
      if (res.ok) {
        toast.success(res.message);
        onValidated?.();
      } else toast.error(res.message);
    });

  const title = disabled
    ? `À compléter avant de valider : ${missing.join(', ')}`
    : 'Créer cette écriture dans Comptaweb';

  return (
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
    >
      Valider
    </Button>
  );
}
