'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { NativeSelect } from '@/components/ui/native-select';

// Sélecteur de catégorie en deux étages :
// - chips rapides pour les N catégories favorites (les plus utilisées
//   par le groupe, calculées côté serveur)
// - select déroulant pour le reste, replié par défaut
//
// La valeur sélectionnée est portée par un input hidden, donc compatible
// avec les server actions (FormData). Si `topIds` est vide, dégrade vers
// un simple select complet.

export interface CategoryOption {
  id: string;
  name: string;
  /** True si l'item n'a pas de comptaweb_id (héritage local pur).
   *  Affiché avec un suffixe "(non sync)" pour informer l'utilisateur. */
  unmapped?: boolean;
}

function decorate(c: CategoryOption): string {
  return c.unmapped ? `${c.name} (non sync)` : c.name;
}

export function CategoryPicker({
  categories,
  topIds,
  name,
  id,
  defaultValue,
  allowEmpty = true,
  emptyLabel = 'Aucune',
  disabled = false,
}: {
  categories: CategoryOption[];
  topIds: string[];
  name: string;
  id?: string;
  defaultValue?: string | null;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string>(defaultValue ?? '');

  const byId = new Map(categories.map((c) => [c.id, c]));
  const topCats = topIds
    .map((tid) => byId.get(tid))
    .filter((c): c is CategoryOption => Boolean(c));
  const topIdSet = new Set(topCats.map((c) => c.id));
  const otherCats = categories.filter((c) => !topIdSet.has(c.id));

  // Si pas de favoris (groupe vierge), un select complet suffit.
  if (topCats.length === 0) {
    return (
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue ?? ''}
        disabled={disabled}
      >
        {allowEmpty && <option value="">— {emptyLabel} —</option>}
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {decorate(c)}
          </option>
        ))}
      </NativeSelect>
    );
  }

  // Le select des "autres" ne reflète une valeur que si elle est hors
  // top. Sinon il reste sur l'option neutre.
  const selectValue = topIdSet.has(value) || value === '' ? '' : value;
  const selectedOther = selectValue ? byId.get(selectValue) : null;

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" id={id}>
        {allowEmpty && (
          <Chip
            active={value === ''}
            disabled={disabled}
            onClick={() => setValue('')}
          >
            {emptyLabel}
          </Chip>
        )}
        {topCats.map((c) => (
          <Chip
            key={c.id}
            active={value === c.id}
            disabled={disabled}
            onClick={() => setValue(c.id)}
          >
            {decorate(c)}
          </Chip>
        ))}
        {selectedOther && (
          <Chip active disabled={disabled} onClick={() => setValue('')}>
            {decorate(selectedOther)} ✕
          </Chip>
        )}
      </div>
      {otherCats.length > 0 && (
        <NativeSelect
          value={selectValue}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          aria-label="Autres catégories"
          className="text-[12.5px]"
        >
          <option value="">— Voir toutes les autres catégories —</option>
          {otherCats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-brand bg-brand text-white shadow-sm'
          : 'border-border bg-bg-elevated text-fg hover:border-border-strong hover:bg-bg-sunken',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  );
}
