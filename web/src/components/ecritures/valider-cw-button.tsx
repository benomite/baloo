'use client';

import { Button } from '@/components/ui/button';

// CTA compact « Valider » d'une carte écriture en draft. Présentational :
// la validation (push Comptaweb, lent + irréversible) est orchestrée par le
// parent (`EcrituresInfiniteList`) qui verrouille la ligne pendant l'appel et
// la retire de « À traiter » au succès. Plus de `window.confirm` ici : le
// trésorier valide ses lignes en série, une confirmation à chaque clic est un
// frein (demande terrain 2026-06-29). Le bouton reste gardé par
// `computeReadiness` côté appelant (`disabled` si l'écriture est incomplète).
export function ValiderCwButton({
  disabled = false,
  missing = [],
  onValidate,
}: {
  disabled?: boolean;
  missing?: string[];
  /** Déclenche la validation : le parent prend la main (verrou + retrait). */
  onValidate: () => void;
}) {
  const title = disabled
    ? `À compléter avant de valider : ${missing.join(', ')}`
    : 'Créer cette écriture dans Comptaweb';

  return (
    <Button
      size="sm"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onValidate();
      }}
      title={title}
    >
      Valider
    </Button>
  );
}
