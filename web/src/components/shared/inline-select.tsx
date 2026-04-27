'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

export interface InlineOption {
  value: string;
  label: string;
}

interface Props {
  value: string | null | undefined;
  options: InlineOption[];
  display: ReactNode;
  onSave: (value: string | null) => Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}

// Cellule éditable : affiche `display` jusqu'au clic, puis un select natif.
// Au change → onSave async → retour en mode display. Blur sans changement =
// retour immédiat. Désactivé quand `disabled` (ex: saisie Comptaweb).
export function InlineSelect({ value, options, display, onSave, disabled, placeholder = '—', allowClear = true }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) selectRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        className={`text-left inline-flex items-center -mx-1 px-1 rounded ${disabled ? 'cursor-not-allowed' : 'hover:bg-muted/60 cursor-pointer'}`}
        title={disabled ? 'Non modifiable' : 'Cliquer pour modifier'}
      >
        {display}
      </button>
    );
  }

  const commit = (newValue: string | null) => {
    if (newValue === (value ?? null)) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await onSave(newValue);
      if (!result.ok) {
        toast.error(result.message ?? 'Mise à jour refusée');
      }
      setEditing(false);
    });
  };

  return (
    <select
      ref={selectRef}
      defaultValue={value ?? ''}
      disabled={pending}
      onChange={(e) => commit(e.target.value || null)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
      className="w-full border rounded px-1.5 py-0.5 text-sm bg-background"
    >
      {allowClear && <option value="">— {placeholder} —</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
