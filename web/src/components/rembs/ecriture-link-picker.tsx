'use client';

import { useState } from 'react';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';
import { PendingButton } from '@/components/shared/pending-button';
import { Field } from '@/components/shared/field';

// Sélecteur recherchable d'écriture à lier. La server action bindée est
// passée en prop (`action`) ; on pose la sélection dans un input caché
// `ecriture_id` que l'action lit dans le FormData. Submit désactivé tant
// qu'aucune écriture n'est choisie.
export function EcritureLinkPicker({
  rembsId,
  items,
  action,
}: {
  rembsId: string;
  items: ComboboxItem[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="ecriture_id" value={value} />
      <Field label="Écriture (virement)" htmlFor={`ecriture-${rembsId}`}>
        <Combobox
          id={`ecriture-${rembsId}`}
          items={items}
          value={value}
          onValueChange={setValue}
          placeholder="— Choisir une écriture —"
          searchPlaceholder="Rechercher par date, montant, libellé…"
          ariaLabel="Écriture à lier"
        />
      </Field>
      <div className="flex justify-end">
        <PendingButton size="sm" pendingLabel="Liaison…" disabled={!value}>
          Lier à cette écriture
        </PendingButton>
      </div>
    </form>
  );
}
