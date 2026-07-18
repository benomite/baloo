'use client';

import { useState, type ReactNode } from 'react';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';

// Sélecteur de catégorie en combobox recherchable (Base UI via le
// wrapper `Combobox`), avec deux sections : "Fréquentes" (les N
// catégories les plus utilisées par le groupe, calculées côté serveur)
// puis "Toutes" (le reste, ordre d'entrée).
//
// La valeur sélectionnée est portée par un input hidden, donc compatible
// avec les server actions (FormData).

export interface CategoryOption {
  id: string;
  name: string;
  /** True si l'item n'a pas de comptaweb_id (héritage local pur).
   *  Affiché avec un suffixe "(non sync)" pour informer l'utilisateur. */
  unmapped?: boolean;
  /** Sens de la catégorie ; sert au filtre `sens`. */
  type?: 'depense' | 'recette' | 'les_deux';
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
  onChange,
  sens,
  ariaLabel,
  renderTrigger,
}: {
  categories: CategoryOption[];
  topIds: string[];
  name: string;
  id?: string;
  defaultValue?: string | null;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  /**
   * Optionnel : notifie le parent à chaque changement, en plus de l'état
   * interne. Ajouté pour le répéteur de ventilations (Task 7) qui a
   * besoin de lever la sélection catégorie dans un état contrôlé
   * (`vents`) — la valeur "source de vérité" reste le hidden input
   * (`name`) lu via FormData dans les usages historiques non concernés.
   */
  onChange?: (value: string) => void;
  /** Filtre par sens (dépense/recette) : masque les catégories de l'autre
   *  sens (garde `les_deux` et la valeur déjà sélectionnée). */
  sens?: 'depense' | 'recette';
  /** Nom accessible explicite. Par défaut absent → l'association `<label
   *  htmlFor={id}>` du Field porte le nom (ex. « Catégorie ligne 1 »), sans
   *  être écrasée par un aria-label générique. */
  ariaLabel?: string;
  /** Déclencheur custom (puce inline sur une ligne d'écriture). Quand fourni,
   *  le picker s'affiche en puce au lieu du champ pleine largeur. La sélection
   *  reste pilotée par `onChange` (les usages inline persistent via une action
   *  serveur, pas via FormData). */
  renderTrigger?: ReactNode;
}) {
  const [value, setValueState] = useState<string>(defaultValue ?? '');
  const setValue = (v: string) => {
    setValueState(v);
    onChange?.(v);
  };

  const byId = new Map(categories.map((c) => [c.id, c]));
  const topIdSet = new Set(topIds);

  // Filtre sens : garde matching + 'les_deux'. Exception : la valeur
  // sélectionnée reste toujours visible (jamais masquer une valeur posée).
  const passesSens = (c: CategoryOption): boolean =>
    !sens || c.type == null || c.type === 'les_deux' || c.type === sens || c.id === value;

  const items: ComboboxItem[] = [];
  if (allowEmpty) items.push({ value: '', label: emptyLabel });
  // Fréquentes (ordre de topIds), filtrées sens
  for (const tid of topIds) {
    const c = byId.get(tid);
    if (c && passesSens(c)) items.push({ value: c.id, label: decorate(c), group: 'Fréquentes' });
  }
  // Toutes (le reste, ordre d'entrée), filtrées sens
  for (const c of categories) {
    if (topIdSet.has(c.id)) continue;
    if (passesSens(c)) items.push({ value: c.id, label: decorate(c), group: 'Toutes' });
  }

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Combobox
        id={id}
        ariaLabel={ariaLabel}
        renderTrigger={renderTrigger}
        items={items}
        value={value}
        onValueChange={setValue}
        placeholder={`— ${emptyLabel} —`}
        searchPlaceholder="Rechercher une catégorie…"
        emptyText="Aucune catégorie trouvée"
        disabled={disabled}
      />
    </>
  );
}
