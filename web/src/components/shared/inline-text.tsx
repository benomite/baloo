'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  value: string;
  display: ReactNode;
  onSave: (value: string) => Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
  title?: string;
  inputClassName?: string;
}

// Cellule texte éditable : affiche `display` jusqu'au clic, puis un input.
// Au focus, tout est sélectionné (remplacement rapide d'un libellé brut).
// Entrée / blur valident, Échap annule. Un vide ou un texte inchangé annule
// sans appeler onSave (pas de titre vide — cf. garde service).
export function InlineText({ value, display, onSave, disabled, title, inputClassName }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!disabled) setEditing(true); }}
        disabled={disabled}
        className="text-left inline-flex items-center max-w-full min-w-0 cursor-text"
        title={disabled ? 'Non modifiable' : title ?? 'Cliquer pour renommer'}
      >
        {display}
      </button>
    );
  }

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next === '' || next === value) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await onSave(next);
      if (!result.ok) toast.error(result.message ?? 'Renommage refusé');
      setEditing(false);
    });
  };

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); }
        else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
      }}
      onBlur={(e) => commit(e.target.value)}
      className={inputClassName ?? 'w-full border rounded px-1.5 py-0.5 text-[13.5px] bg-background'}
    />
  );
}
