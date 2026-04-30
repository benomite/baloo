'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

// `<SelectField>` : wrapper haut-niveau autour du `<Select>` shadcn /
// @base-ui qui prend une API simple `options[]` au lieu d'attendre que
// le caller compose `<SelectTrigger>/<SelectContent>/<SelectItem>`.
// Utilisable dans un <form> (pose un input hidden via `name`).
//
// Pour des cas avancés (groupes, séparateurs, items custom), utilise
// directement le Select shadcn.

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  /** Pastille colorée à gauche de l'option (couleur d'unité par ex.). */
  swatch?: string | null;
}

interface SelectFieldProps {
  name?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Affiche une option vide en tête (ex: "— Aucune —"). */
  emptyOption?: { value: string; label: React.ReactNode };
}

export function SelectField({
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  emptyOption,
}: SelectFieldProps) {
  const allOptions = emptyOption ? [emptyOption as SelectOption, ...options] : options;
  return (
    <Select
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder ?? '— Choisir —'} />
      </SelectTrigger>
      <SelectContent>
        {allOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.swatch && (
              <span
                aria-hidden
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: opt.swatch }}
              />
            )}
            <span>{opt.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
