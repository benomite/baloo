# Sélecteur de catégorie — combobox recherchable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le `<select>` natif à plat de sélection de catégorie par un combobox recherchable (favoris en tête + filtre par sens), dans le composant partagé `CategoryPicker`, donc dans tous les formulaires — sans prendre plus de place que le select actuel.

**Architecture:** Nouvelle primitive `ui/combobox.tsx` (wrapper mince sur `@base-ui/react/combobox`, comme `ui/select.tsx` sur `select`). `CategoryPicker` réécrit dessus (même API publique + prop `sens`). Câblage des vrais favoris + du sens dans `imputation-grid` (raccourci orange) puis `ecriture-form`/dépôts.

**Tech Stack:** Next 16, React, TypeScript, `@base-ui/react` v1.4, Tailwind v4, vitest + @testing-library/react (jsdom).

## Global Constraints

- Tests via **`npx vitest run <chemin>` depuis `web/`** (JAMAIS `pnpm vitest`).
- Surface popover **opaque** (`bg-popover`/`bg-bg-elevated`) + `z-50` + Portal — pas de piège transparence (cf. fix `bg-surface` 2026-07-15).
- **Compat FormData** : `CategoryPicker` conserve un `<input type="hidden" name value>` reflétant la sélection (les server actions lisent `category_id` via FormData).
- **Ne jamais masquer la valeur sélectionnée** : sous filtre `sens`, la catégorie déjà sélectionnée reste toujours dans la liste (zéro perte silencieuse).
- **API publique de `CategoryPicker` inchangée** hormis l'ajout du prop optionnel `sens` et du champ optionnel `type` sur `CategoryOption`.
- Français pour tout texte user-facing. Commits **LOCAUX**, **jamais** push.
- Encombrement fermé = **une ligne** (hauteur/police alignées sur `NativeSelect`).

---

### Task 1 : Primitive `ui/combobox.tsx` (wrapper Base UI)

**Files:**
- Create: `web/src/components/ui/combobox.tsx`
- Test: `web/src/components/ui/__tests__/combobox.test.tsx`

**Interfaces:**
- Produces :
```ts
export interface ComboboxItem { value: string; label: string; group?: string }
export interface ComboboxProps {
  items: ComboboxItem[];        // ordre = ordre d'affichage ; `group` regroupe (sections dans l'ordre de 1re apparition)
  value: string;                // '' = aucune
  onValueChange: (value: string) => void;
  placeholder?: string;         // libellé du déclencheur quand value=''
  searchPlaceholder?: string;
  emptyText?: string;           // libellé quand aucun résultat (défaut « Aucun résultat »)
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;           // classes du déclencheur
}
export function Combobox(props: ComboboxProps): React.JSX.Element
```

**Contexte Base UI (vérifier contre `node_modules/@base-ui/react/combobox` + https://base-ui.com/react/components/combobox) :**
- Parts : `Combobox.Root`, `.Input`, `.List`, `.Item`, `.Group`, `.GroupLabel`, `.Collection`, `.Empty`, `.Popup`, `.Positioner`, `.Portal`, `.Trigger`, `.Value`, `.Icon`.
- `Root` accepte `items` **plat** (`readonly any[]`) OU **groupé** (`readonly {value,items}[]`) ; il filtre selon la saisie (`filter` par défaut, surchargable). Items objets `{value,label}` → `label` sert à l'affichage/au filtre, `value` à la sélection (défaut, pas besoin de `itemToStringLabel`).
- Sélection mono : `value` + `onValueChange` (le mode multiple est OFF par défaut).
- Copier les tokens de style de `ui/select.tsx` : déclencheur `flex w-full items-center justify-between … rounded-lg border border-border bg-bg-elevated h-10 …`, popup `z-50 … rounded-lg border border-border bg-popover text-popover-foreground shadow-lg`, item `data-highlighted:bg-brand-50 data-highlighted:text-brand`, group-label `px-1.5 py-1 text-xs text-muted-foreground`.

**Structure interne cible :** le wrapper transforme `items` (plat, avec `group?`) en structure groupée Base UI en **préservant l'ordre** (sections dans l'ordre de première apparition d'un `group` ; items sans `group` dans une section sans label rendue en premier). Il passe cette structure à `Root items=…` et rend `List` → pour chaque section : `Group` + (`GroupLabel` si label) + `Collection`/map → `Item`. `Empty` pour zéro résultat. `Input` (recherche) en haut du `Popup`, autofocus à l'ouverture (comportement Base UI par défaut). Déclencheur = `Trigger` affichant le `label` de `value` courant (ou `placeholder`), tronqué `truncate`, chevron `ChevronsUpDown`.

- [ ] **Step 1 : Write the failing test**

Créer `combobox.test.tsx` avec `@testing-library/react` + `@testing-library/user-event`. (S'inspirer d'un test composant existant, ex. `src/components/ecritures/__tests__/imputation-grid.test.tsx`, pour le setup jsdom.) Cas :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxItem } from '../combobox';

const ITEMS: ComboboxItem[] = [
  { value: 'a', label: 'Alpha', group: 'Fréquentes' },
  { value: 'b', label: 'Bravo', group: 'Fréquentes' },
  { value: 'c', label: 'Charlie', group: 'Toutes' },
  { value: 'd', label: 'Delta', group: 'Toutes' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = (globalThis as any).React?.useState?.(initial) ?? [initial, () => {}];
  return <Combobox items={ITEMS} value={v} onValueChange={setV} placeholder="Choisir" ariaLabel="cat" />;
}

describe('Combobox', () => {
  it('affiche le placeholder quand value vide, et le label quand value posée', () => {
    const { rerender } = render(<Combobox items={ITEMS} value="" onValueChange={() => {}} placeholder="Choisir" ariaLabel="cat" />);
    expect(screen.getByText('Choisir')).toBeInTheDocument();
    rerender(<Combobox items={ITEMS} value="c" onValueChange={() => {}} placeholder="Choisir" ariaLabel="cat" />);
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('ouvre, filtre à la frappe et sélectionne (onValueChange)', async () => {
    const onChange = vi.fn();
    render(<Combobox items={ITEMS} value="" onValueChange={onChange} placeholder="Choisir" searchPlaceholder="Rechercher" ariaLabel="cat" />);
    await userEvent.click(screen.getByRole('combobox'));
    const search = screen.getByPlaceholderText('Rechercher');
    await userEvent.type(search, 'char');
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Charlie'));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('affiche emptyText quand aucun résultat', async () => {
    render(<Combobox items={ITEMS} value="" onValueChange={() => {}} placeholder="Choisir" searchPlaceholder="Rechercher" emptyText="Rien trouvé" ariaLabel="cat" />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByPlaceholderText('Rechercher'), 'zzzz');
    expect(screen.getByText('Rien trouvé')).toBeInTheDocument();
  });

  it('rend les libellés de groupe', async () => {
    render(<Combobox items={ITEMS} value="" onValueChange={() => {}} placeholder="Choisir" ariaLabel="cat" />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('Fréquentes')).toBeInTheDocument();
    expect(screen.getByText('Toutes')).toBeInTheDocument();
  });
});
```

Si l'API Base UI diffère (noms de rôles, portal non monté en jsdom), **adapter les sélecteurs du test** (ex. `getByRole('combobox')` peut devoir cibler le `Trigger`), mais garder les 4 comportements. Ne pas affaiblir les assertions de comportement.

- [ ] **Step 2 : Run test to verify it fails**

Run : `npx vitest run src/components/ui/__tests__/combobox.test.tsx`
Expected : FAIL (module absent).

- [ ] **Step 3 : Implement `ui/combobox.tsx`**

Implémenter le wrapper selon la structure cible ci-dessus, en s'appuyant sur `ui/select.tsx` pour les classes. **Vérifier chaque part/prop contre les types installés** (`node_modules/@base-ui/react/combobox/**/*.d.ts`). Points clés :
- Transformer `items` plat → groupes ordonnés (helper local `toGroups(items)`).
- `Root` : `value`, `onValueChange`, `items` (structure groupée), `open`/`onOpenChange` gérés en interne par Base UI (non contrôlés).
- Popup porté (`Portal` + `Positioner className="z-50"`), largeur ancrée (`w-(--anchor-width)` comme le select), surface **opaque**.
- `Input` dans le popup, `Empty` avec `emptyText`.
- Déclencheur : `Trigger` + `Value` (affiche le label courant) + chevron ; `ariaLabel`/`id`/`disabled`/`className` transmis.

- [ ] **Step 4 : Run test to verify it passes**

Run : `npx vitest run src/components/ui/__tests__/combobox.test.tsx`
Expected : PASS (4/4).

- [ ] **Step 5 : Typecheck**

Run : `npx tsc --noEmit`
Expected : 0 erreur.

- [ ] **Step 6 : Commit**

```bash
git add web/src/components/ui/combobox.tsx web/src/components/ui/__tests__/combobox.test.tsx
git commit -m "feat(ui): primitive Combobox recherchable (wrapper Base UI)"
```

---

### Task 2 : Réécriture de `CategoryPicker` sur le combobox

**Files:**
- Modify: `web/src/components/shared/category-picker.tsx`
- Test: `web/src/components/shared/__tests__/category-picker.test.tsx` (créer si absent)

**Interfaces:**
- Consumes: `Combobox`, `ComboboxItem` (Task 1).
- Produces (API publique — inchangée sauf ajouts) :
```ts
export interface CategoryOption { id: string; name: string; unmapped?: boolean; type?: 'depense' | 'recette' | 'les_deux' }
export function CategoryPicker(props: {
  categories: CategoryOption[];
  topIds: string[];
  name: string;
  id?: string;
  defaultValue?: string | null;
  allowEmpty?: boolean;        // défaut true
  emptyLabel?: string;         // défaut 'Aucune'
  disabled?: boolean;
  onChange?: (value: string) => void;
  sens?: 'depense' | 'recette'; // NOUVEAU — filtre par sens
}): React.JSX.Element
```

- [ ] **Step 1 : Write the failing tests**

Créer/étendre `category-picker.test.tsx` (même setup jsdom que Task 1). Fixtures avec `type` et `unmapped`. Cas :

```tsx
// Fixtures : cats = [
//   {id:'freq1', name:'Intendance', type:'depense'},
//   {id:'x', name:'Carburant', type:'depense'},
//   {id:'rec1', name:'Cotisations SGDF', type:'recette'},
//   {id:'both', name:'Flux structures', type:'les_deux'},
//   {id:'loc', name:'Loyer', type:'depense', unmapped:true},
// ]; topIds = ['freq1']

// 1. « Fréquentes » avant « Toutes », favori non dupliqué
it('liste les Fréquentes avant Toutes, sans doublon', async () => {
  render(<CategoryPicker categories={cats} topIds={['freq1']} name="category_id" />);
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByText('Fréquentes')).toBeInTheDocument();
  expect(screen.getByText('Toutes')).toBeInTheDocument();
  // 'Intendance' apparaît une seule fois (dans Fréquentes)
  expect(screen.getAllByText('Intendance')).toHaveLength(1);
});

// 2. Filtre sens : recette pure masquée en dépense ; les_deux visible
it('filtre par sens (dépense) : cache la recette pure, garde les_deux', async () => {
  render(<CategoryPicker categories={cats} topIds={[]} name="category_id" sens="depense" />);
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.queryByText('Cotisations SGDF')).not.toBeInTheDocument();
  expect(screen.getByText('Flux structures')).toBeInTheDocument();
});

// 3. La valeur sélectionnée d'un autre sens reste affichée (pas de perte)
it('garde la catégorie sélectionnée même hors sens', async () => {
  render(<CategoryPicker categories={cats} topIds={[]} name="category_id" sens="depense" defaultValue="rec1" />);
  // fermé : le déclencheur montre la valeur
  expect(screen.getByText('Cotisations SGDF')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox'));
  // ouverte : elle est toujours présente dans la liste
  expect(screen.getByText('Cotisations SGDF')).toBeInTheDocument();
});

// 4. Hidden input reflète la sélection (FormData) + onChange
it('met à jour le hidden input et appelle onChange', async () => {
  const onChange = vi.fn();
  const { container } = render(<CategoryPicker categories={cats} topIds={[]} name="category_id" onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(screen.getByText('Carburant'));
  expect(onChange).toHaveBeenCalledWith('x');
  const hidden = container.querySelector('input[name="category_id"]') as HTMLInputElement;
  expect(hidden.value).toBe('x');
});

// 5. allowEmpty : option « Aucune » sélectionnable → ''
it('permet de choisir Aucune', async () => {
  const onChange = vi.fn();
  render(<CategoryPicker categories={cats} topIds={[]} name="category_id" defaultValue="x" onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(screen.getByText('Aucune'));
  expect(onChange).toHaveBeenCalledWith('');
});

// 6. unmapped → suffixe (non sync)
it('décore les catégories non sync', async () => {
  render(<CategoryPicker categories={cats} topIds={[]} name="category_id" />);
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByText(/Loyer \(non sync\)/)).toBeInTheDocument();
});
```

- [ ] **Step 2 : Run tests to verify they fail**

Run : `npx vitest run src/components/shared/__tests__/category-picker.test.tsx`
Expected : FAIL.

- [ ] **Step 3 : Réécrire `CategoryPicker`**

Remplacer entièrement le corps (supprimer la logique chips/deux-modes et le sous-composant `Chip`). Nouvelle implémentation :

```tsx
'use client';

import { useState } from 'react';
import { Combobox, type ComboboxItem } from '@/components/ui/combobox';

export interface CategoryOption {
  id: string;
  name: string;
  unmapped?: boolean;
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
}: {
  categories: CategoryOption[];
  topIds: string[];
  name: string;
  id?: string;
  defaultValue?: string | null;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  sens?: 'depense' | 'recette';
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
        ariaLabel="Catégorie"
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
```

Note : l'option « Aucune » (value `''`) est un item sans `group` → rendu en premier (section sans label). Le placeholder du déclencheur reprend `emptyLabel`.

- [ ] **Step 4 : Run tests to verify they pass**

Run : `npx vitest run src/components/shared/__tests__/category-picker.test.tsx`
Expected : PASS (6/6). Ajuster les sélecteurs si besoin (ne pas affaiblir le comportement).

- [ ] **Step 5 : Non-régression + typecheck**

Run : `npx vitest run src/components/` puis `npx tsc --noEmit`
Expected : les tests qui montaient l'ancien `CategoryPicker` (chips) peuvent casser → adapter leurs assertions au combobox. tsc : `CategoryOption` gagne `type?` — les call sites qui ne le passent pas restent valides (optionnel).

- [ ] **Step 6 : Commit**

```bash
git add web/src/components/shared/category-picker.tsx web/src/components/shared/__tests__/category-picker.test.tsx
git commit -m "feat(ui): CategoryPicker en combobox (Fréquentes en tête + filtre sens)"
```

---

### Task 3 : Câblage raccourci orange (`imputation-grid`) — vrais favoris + sens

**Files:**
- Modify: `web/src/components/ecritures/imputation-grid.tsx`
- Modify: `web/src/components/ecritures/ecriture-inline-panel.tsx` (thread `topCategoryIds` + `sens`)
- Modify: `web/src/components/ecritures/ecritures-table.tsx` (si elle instancie `ImputationGrid` directement — sinon via le panel)
- Modify: `web/src/components/ecritures/pinned-ecriture-panel.tsx` (idem si applicable)
- Test: étendre `web/src/components/ecritures/__tests__/imputation-grid.test.tsx`

**Interfaces:**
- Consumes: `CategoryPicker` avec `sens` + `type` (Task 2).
- Produces: `ImputationGridProps` gagne `topCategoryIds: string[]` et `sens?: 'depense' | 'recette'`.

- [ ] **Step 1 : Write the failing test**

Étendre `imputation-grid.test.tsx` : monter `ImputationGrid` avec `categories` typées, `topCategoryIds=['<id>']`, `sens='depense'`, ouvrir le picker catégorie et vérifier (a) que « Fréquentes » apparaît (favori pris en compte, plus de `topIds=[]`), (b) qu'une catégorie `recette` pure est absente. Réutiliser les fixtures/harnais du fichier.

- [ ] **Step 2 : Run to verify fail**

Run : `npx vitest run src/components/ecritures/__tests__/imputation-grid.test.tsx`
Expected : FAIL (props absents / favoris vides).

- [ ] **Step 3 : Ajouter les props à `ImputationGridProps` + les utiliser**

Dans `imputation-grid.tsx` :
- Ajouter à `ImputationGridProps` : `topCategoryIds: string[];` et `sens?: 'depense' | 'recette';`
- `categoryOptions` (≈ ligne 93) : inclure le `type` → `categories.map((c) => ({ id: c.id, name: c.name, type: c.type, unmapped: c.comptaweb_id == null }))` (vérifier le champ réel qui marque unmapped ; s'aligner sur l'usage existant `isUnmapped`).
- Les deux `<CategoryPicker>` (mono + ventilé, ≈ lignes 198-208) : remplacer `topIds={[]}` par `topIds={topCategoryIds}` et ajouter `sens={sens}`.

- [ ] **Step 4 : Threader `topCategoryIds` + `sens` depuis les parents**

- `ecriture-inline-panel.tsx` : il reçoit déjà `topCategoryIds` (prop, ligne ~44) et connaît l'écriture → passer `topCategoryIds={topCategoryIds}` et `sens={ecriture.type}` au `<ImputationGrid>`.
- `pinned-ecriture-panel.tsx` : idem si applicable (il a `topCategoryIds` ligne ~17).
- `ecritures-table.tsx` : si un `<ImputationGrid>` y est monté directement (sinon rien à faire — c'est via le panel). Vérifier ; le cas échéant passer `topCategoryIds` (déjà prop) + `sens` (type de la ligne/aggregate).
- Vérifier qu'aucun autre appelant d'`ImputationGrid` ne casse (tsc = filet, `topCategoryIds` devient requis).

- [ ] **Step 5 : Run tests to verify they pass**

Run : `npx vitest run src/components/ecritures/` puis `npx tsc --noEmit`
Expected : PASS ; adapter les tests panel/table qui montaient l'ancienne grille.

- [ ] **Step 6 : Commit**

```bash
git add web/src/components/ecritures/imputation-grid.tsx web/src/components/ecritures/ecriture-inline-panel.tsx web/src/components/ecritures/pinned-ecriture-panel.tsx web/src/components/ecritures/ecritures-table.tsx web/src/components/ecritures/__tests__/imputation-grid.test.tsx
git commit -m "feat(ecritures): raccourci orange — favoris réels + filtre sens sur la catégorie"
```

---

### Task 4 : Câblage `ecriture-form` (sens réactif) + dépôts (type)

**Files:**
- Modify: `web/src/components/ecritures/ecriture-form.tsx`
- Modify: `web/src/app/(app)/depot/page.tsx`, `web/src/app/(app)/depots/page.tsx` (mapping `type` dans les options catégorie)
- Test: étendre le test de `ecriture-form` s'il existe (sinon test ciblé minimal du sens réactif)

**Interfaces:**
- Consumes: `CategoryPicker` avec `sens` + `type` (Task 2).

- [ ] **Step 1 : Write the failing test (sens réactif)**

Dans le test de `ecriture-form` : rendre le formulaire (mode wizard), sélectionner le type « recette » via le select `#type`, ouvrir le `CategoryPicker` et vérifier qu'une catégorie `depense` pure n'est plus proposée (et inversement). Si aucun test ecriture-form n'existe, créer un test ciblé minimal qui monte le sous-arbre pertinent. (Le combobox est déjà couvert par Task 1/2 ; ici on teste seulement la **réactivité du sens** au champ type.)

- [ ] **Step 2 : Run to verify fail**

Run : `npx vitest run src/components/ecritures/__tests__/` (fichier ecriture-form)
Expected : FAIL (sens non réactif : la catégorie dépense reste proposée en recette).

- [ ] **Step 3 : Rendre le `sens` réactif dans `ecriture-form`**

Le champ type est aujourd'hui non-contrôlé (`NativeSelect id="type" name="type" defaultValue={ecriture?.type ?? 'depense'}`, ≈ ligne 134). Introduire un state :
```tsx
const [sens, setSens] = useState<'depense' | 'recette'>(ecriture?.type === 'recette' ? 'recette' : 'depense');
```
Ajouter `onChange={(e) => setSens(e.target.value === 'recette' ? 'recette' : 'depense')}` au select type (garder `name="type"` pour FormData).
Sur chaque `<CategoryPicker>` du formulaire (≈ ligne 218) :
- inclure `type` dans le mapping `categories` (`{ id: c.id, name: c.name, unmapped: isUnmapped(c), type: c.type }`) ;
- ajouter `sens={sens}`.

- [ ] **Step 4 : Dépôts — mapping `type` (sans `sens`)**

Dans `depot/page.tsx` et `depots/page.tsx` : là où les catégories sont mappées pour `CategoryPicker`, inclure `type: c.type` (pour que le picker soit prêt à filtrer plus tard). **Ne PAS passer `sens`** (liste complète, mais désormais recherchable — cf. spec). Si les pages passent déjà des `Category` complets à un composant intermédiaire, vérifier que `type` arrive bien jusqu'au picker.

- [ ] **Step 5 : Run tests + typecheck + build**

Run : `npx vitest run src/components/ecritures/ src/app` (les tests concernés) puis `npx tsc --noEmit` puis `npx next build`.
Expected : PASS, 0 erreur tsc, build OK.

- [ ] **Step 6 : Commit**

```bash
git add web/src/components/ecritures/ecriture-form.tsx "web/src/app/(app)/depot/page.tsx" "web/src/app/(app)/depots/page.tsx"
git commit -m "feat(ecritures): formulaire détaillé — sens réactif ; dépôts — catégorie recherchable"
```

---

## Self-Review (contrôleur, après le plan)

- **Spec coverage :** primitive combobox = T1 ; CategoryPicker (favoris + sens + hidden input + selected-always-shown + unmapped) = T2 ; raccourci orange (favoris réels + sens) = T3 ; formulaire détaillé (sens réactif) + dépôts = T4. ✅
- **Type consistency :** `ComboboxItem {value,label,group?}` (T1) ; `CategoryOption` gagne `type?` (T2) ; `ImputationGridProps` gagne `topCategoryIds`+`sens?` (T3). Cohérent.
- **Ordre / dépendances :** T1 → T2 → (T3, T4 indépendantes entre elles, toutes deux après T2). Exécuter 1→4.
- **Risques :** API Base UI Combobox (T1, tâche de découverte — modèle capable, TDD) ; jsdom + portal (adapter sélecteurs sans affaiblir le comportement) ; surface opaque (test visuel post-merge) ; ne jamais masquer la valeur sélectionnée (testé T2 cas 3).
