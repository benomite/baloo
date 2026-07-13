# Panneau d'écriture v2 — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resserrer le panneau d'écriture autour de l'imputation (grille unifiée mono/ventilé, montant à droite, unité par ligne, ventilation en place), sans répéter le bandeau, statut en footer, justifs en bas, bandeau replié sur 2 lignes, mode de paiement en pastille dédiée.

**Architecture:** Refonte purement front-end. On réutilise les endpoints existants : `PATCH /api/ecritures/[id]/field` (édition mono champ par champ) et `PUT /api/ecritures/[id]/ventilations` (éclatement, livré au sous-projet #20). Le modèle pur `ventilate-editor-model.ts` est simplifié (lignes autonomes, plus de défauts/override). Un nouveau composant `ImputationGrid` remplace `VentilationEditor`. Le panneau et la ligne repliée sont restructurés.

**Tech Stack:** Next 16 App Router, React (client components), TypeScript, Tailwind, vitest + @testing-library/react.

## Global Constraints

- **Aucune migration, aucun nouvel endpoint.** Réutiliser `PATCH /api/ecritures/[id]/field` (mono) et `PUT /api/ecritures/[id]/ventilations` (ventilé).
- **Montant à droite** dans la grille (colonnes `Unité · Catégorie · Activité · Montant · ✕`). Format FR `"42,50"`, `parseAmount`/`formatAmount` de `@/lib/format`.
- **Unité par ligne** : chaque ligne porte ses 3 dimensions ; une nouvelle ligne hérite Unité + Activité de la ligne précédente (logique composant).
- **Transition en place** : « + Ajouter un détail » transforme la donnée existante en 1ʳᵉ ligne (colonne Montant révélée, pré-remplie au total) + ajoute 1 ligne héritée. Aucun changement d'écran. Animation respectant `prefers-reduced-motion`.
- **Solde vivant** : `✓ <total> — équilibré` (vert, Σ = total), `⚠ reste <x> à ventiler` (ambre, Σ < total), `⚠ dépasse de <x>` (rouge, Σ > total).
- **Pas de répétition du bandeau** en mode inline (panneau sous une ligne) : ni titre, ni date, ni montant. **Mode épinglé** (panneau autonome via `?open`, sans ligne au-dessus) : garder un en-tête slim (titre + montant + mode).
- **Statut** (`À compléter`, `banque #…`) en **footer** ; **justifs** au-dessus du footer ; **imputation** en tête.
- **Bandeau replié sur 2 lignes max** : à droite montant (l.1) puis `mode pill + Valider` (l.2). Mode sorti des chips d'imputation.
- Périmètre ventilation inchangé (#20) : ventiler seulement `status='draft'` + `comptaweb_ecriture_id IS NULL`.
- Réutiliser les composants UI existants (`NativeSelect`, `CategoryPicker`, `Input`, `Button`, `UniteBadge`) ; pas de nouveau design system.
- Lancer les tests avec **`npx vitest run <chemin>` depuis `web/`** (pas `pnpm vitest`).
- Pas de `git push` sans accord explicite.

---

## File Structure

- `web/src/components/ecritures/ventilate-editor-model.ts` — **simplifier** : lignes autonomes (drop `DefaultImputation`, `override`, param `defaults`).
- `web/src/components/ecritures/imputation-grid.tsx` — **créer** : grille unifiée mono/ventilé (remplace `ventilation-editor.tsx`).
- `web/src/components/ecritures/ventilation-editor.tsx` — **supprimer** (remplacé).
- `web/src/components/ecritures/ecriture-inline-panel.tsx` — **modifier** : imputation en tête, justif en bas, footer statut+actions, en-tête conditionnel inline/épinglé, pastille mode.
- `web/src/components/ecritures/ecritures-table.tsx` — **modifier** : bandeau 2 lignes, mode en pastille droite, chip « Catégories multiples ».
- `web/src/components/ecritures/ecriture-form.tsx` — **modifier** : retirer les selects d'imputation (migrés dans la grille) + le hidden `category_id` multiCategory.
- `web/src/components/ecritures/panel-header.tsx` — **modifier** : rendu slim conditionnel (épinglé vs inline).

---

### Task 1 : Simplifier le modèle pur (lignes autonomes)

**Files:**
- Modify: `web/src/components/ecritures/ventilate-editor-model.ts`
- Modify: `web/src/components/ecritures/__tests__/ventilate-editor-model.test.ts`

**Interfaces:**
- Produces (consommé par Task 2) :
  - `interface VentLine { id: string; amount: string; category_id: string | null; unite_id: string | null; activite_id: string | null }`
  - `interface ResolvedVentilation { amount_cents: number; category_id: string | null; unite_id: string | null; activite_id: string | null }`
  - `resolveVentilations(rows: VentLine[]): ResolvedVentilation[]`
  - `editorRemainderCents(totalCents: number, rows: VentLine[]): number`
  - `isMultiCategory(rows: VentLine[]): boolean`
  - `canSaveVentilation(totalCents: number, rows: VentLine[]): boolean`

- [ ] **Step 1 : Réécrire le test**

Remplacer intégralement `ventilate-editor-model.test.ts` par :

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveVentilations, editorRemainderCents, isMultiCategory, canSaveVentilation,
  type VentLine,
} from '../ventilate-editor-model';

const line = (o: Partial<VentLine>): VentLine => ({
  id: o.id ?? 'l1', amount: o.amount ?? '0', category_id: o.category_id ?? null,
  unite_id: o.unite_id ?? null, activite_id: o.activite_id ?? null,
});

describe('resolveVentilations', () => {
  it('projette chaque ligne en ventilation résolue (cents + 3 dims)', () => {
    const out = resolveVentilations([line({ amount: '7,00', category_id: 'c1', unite_id: 'u1', activite_id: 'a1' })]);
    expect(out).toEqual([{ amount_cents: 700, category_id: 'c1', unite_id: 'u1', activite_id: 'a1' }]);
  });
  it('normalise chaînes vides en null', () => {
    const out = resolveVentilations([{ id: 'l', amount: '', category_id: '', unite_id: '', activite_id: '' }]);
    expect(out[0]).toEqual({ amount_cents: 0, category_id: null, unite_id: null, activite_id: null });
  });
});

describe('editorRemainderCents', () => {
  it('reste = total - somme', () => {
    expect(editorRemainderCents(1064, [line({ amount: '7,00' }), line({ id: 'l2', amount: '3,64' })])).toBe(0);
    expect(editorRemainderCents(1064, [line({ amount: '7,00' })])).toBe(364);
    expect(editorRemainderCents(1064, [line({ amount: '20,00' })])).toBe(-936);
  });
});

describe('isMultiCategory', () => {
  it('vrai dès 2 lignes', () => {
    expect(isMultiCategory([line({})])).toBe(false);
    expect(isMultiCategory([line({}), line({ id: 'l2' })])).toBe(true);
  });
});

describe('canSaveVentilation', () => {
  const ok: VentLine[] = [
    line({ id: 'l1', amount: '7,00', category_id: 'c1', unite_id: 'u1', activite_id: 'a1' }),
    line({ id: 'l2', amount: '3,64', category_id: 'c2', unite_id: 'u1', activite_id: 'a1' }),
  ];
  it('vrai si équilibré et lignes complètes', () => { expect(canSaveVentilation(1064, ok)).toBe(true); });
  it('faux si déséquilibré', () => { expect(canSaveVentilation(2000, ok)).toBe(false); });
  it('faux si une dimension manque', () => {
    expect(canSaveVentilation(1064, [ok[0], { ...ok[1], unite_id: null }])).toBe(false);
  });
  it('faux si un montant est nul', () => {
    expect(canSaveVentilation(700, [ok[0], { ...ok[1], amount: '0' }])).toBe(false);
  });
});
```

- [ ] **Step 2 : Lancer, voir échouer** — `cd web && npx vitest run src/components/ecritures/__tests__/ventilate-editor-model.test.ts` → FAIL (`VentLine` inexistant, `resolveVentilations` mauvaise arité).

- [ ] **Step 3 : Réécrire le module**

```ts
// web/src/components/ecritures/ventilate-editor-model.ts
// Logique pure de la grille d'imputation (spec 2026-07-13 v2). Lignes
// AUTONOMES : chaque ligne porte ses 3 dimensions CW (catégorie, unité,
// activité) + un montant. Total FIGÉ. Aucune dépendance React/DOM.

import { parseAmount } from '@/lib/format';

export interface VentLine {
  id: string;
  amount: string;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export interface ResolvedVentilation {
  amount_cents: number;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export function resolveVentilations(rows: VentLine[]): ResolvedVentilation[] {
  return rows.map((r) => ({
    amount_cents: parseAmount(r.amount || '0'),
    category_id: r.category_id || null,
    unite_id: r.unite_id || null,
    activite_id: r.activite_id || null,
  }));
}

export function editorRemainderCents(totalCents: number, rows: VentLine[]): number {
  return totalCents - rows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0);
}

export function isMultiCategory(rows: VentLine[]): boolean {
  return rows.length >= 2;
}

export function canSaveVentilation(totalCents: number, rows: VentLine[]): boolean {
  if (rows.length < 1) return false;
  if (editorRemainderCents(totalCents, rows) !== 0) return false;
  return resolveVentilations(rows).every(
    (v) => v.amount_cents !== 0 && v.category_id !== null && v.unite_id !== null && v.activite_id !== null,
  );
}
```

- [ ] **Step 4 : Lancer, voir passer** — même commande → PASS.
- [ ] **Step 5 : Commit** — `git commit -m "refactor(ventilation): modèle en lignes autonomes (drop défauts/override)"`

---

### Task 2 : Composant `ImputationGrid` (grille unifiée mono/ventilé)

**Files:**
- Create: `web/src/components/ecritures/imputation-grid.tsx`
- Create: `web/src/components/ecritures/__tests__/imputation-grid.test.tsx`
- Delete: `web/src/components/ecritures/ventilation-editor.tsx` et son test `__tests__/ventilation-editor.test.tsx`

**Interfaces:**
- Consumes: `VentLine`, `ResolvedVentilation`, `resolveVentilations`, `editorRemainderCents`, `isMultiCategory`, `canSaveVentilation` (`./ventilate-editor-model`) ; `NativeSelect`, `CategoryPicker`, `formatAmount`, types `Category`/`Unite`/`Activite`.
- Produces (props, consommé par Task 3) :
  ```ts
  export interface ImputationGridProps {
    totalCents: number;
    initialLines: VentLine[];   // ≥1 ; en mono le montant est ignoré (colonne masquée)
    categories: Category[]; unites: Unite[]; activites: Activite[];
    editable: boolean;
    /** Mono : édition d'un champ de la ligne unique (→ PATCH /field côté panel). */
    onMonoFieldChange: (field: 'unite_id' | 'category_id' | 'activite_id', value: string | null) => void;
    /** Ventilé : enregistrement de N lignes (→ PUT /ventilations côté panel). Ne doit jamais rejeter. */
    onSaveVentilation: (ventilations: ResolvedVentilation[]) => Promise<void>;
    saving?: boolean;
    /** true si l'écriture est déjà un groupe ≥2 à l'ouverture. */
    startVentilated?: boolean;
  }
  ```

**Comportement :**
- Colonnes `Unité · Catégorie · Activité · Montant · ✕`. En **mono** (1 ligne, non `startVentilated`) : colonnes Montant + ✕ masquées (largeur nulle, sans saut de structure) ; changer Unité/Catégorie/Activité appelle `onMonoFieldChange`. En **ventilé** : colonnes révélées, N lignes, solde vivant.
- « + Ajouter un détail » (mono→ventilé) : la ligne existante devient la 1ʳᵉ ligne avec `amount = formatAmount(totalCents)` ; on ajoute 1 ligne héritant `unite_id`/`activite_id` de la ligne précédente, `category_id` + `amount` vides.
- Nouvelles lignes en ventilé héritent Unité/Activité de la ligne précédente.
- Solde : `editorRemainderCents` → `✓ … équilibré` / `⚠ reste … à ventiler` / `⚠ dépasse de …`.
- « Enregistrer la ventilation » : `disabled = !canSaveVentilation(totalCents, lines) || saving` → `onSaveVentilation(resolveVentilations(lines))`.
- « Catégories multiples » affiché quand `isMultiCategory(lines)`.
- `crypto.randomUUID()` avec fallback compteur (reprendre `newRowId` de l'ancien `ventilation-editor.tsx`).

- [ ] **Step 1 : Écrire le test** (`imputation-grid.test.tsx`)

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImputationGrid } from '../imputation-grid';
import type { VentLine } from '../ventilate-editor-model';

const cats = [{ id: 'c-int', name: 'Intendance' }, { id: 'c-ph', name: 'Pharmacie' }] as never[];
const unites = [{ id: 'u-fa', name: 'Farfadets', code: 'FA' }] as never[];
const activites = [{ id: 'a-camps', name: 'Camps' }] as never[];
const mono: VentLine[] = [{ id: 'l1', amount: '41,24', category_id: null, unite_id: 'u-fa', activite_id: 'a-camps' }];

function setup(over = {}) {
  const onMonoFieldChange = vi.fn();
  const onSaveVentilation = vi.fn().mockResolvedValue(undefined);
  render(
    <ImputationGrid totalCents={4124} initialLines={mono} categories={cats} unites={unites}
      activites={activites} editable onMonoFieldChange={onMonoFieldChange} onSaveVentilation={onSaveVentilation} {...over} />,
  );
  return { onMonoFieldChange, onSaveVentilation };
}

describe('ImputationGrid', () => {
  it('mono : édite un champ → onMonoFieldChange (pas de colonne Montant visible)', () => {
    const { onMonoFieldChange } = setup();
    fireEvent.change(screen.getByLabelText(/Activité ligne 1/i), { target: { value: 'a-camps' } });
    expect(onMonoFieldChange).toHaveBeenCalledWith('activite_id', 'a-camps');
    expect(screen.queryByText(/Enregistrer la ventilation/i)).toBeNull();
  });

  it('« Ajouter un détail » passe en ventilé en place : ligne 1 = total, ligne 2 héritée', () => {
    setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const montants = screen.getAllByLabelText(/Montant/i) as HTMLInputElement[];
    expect(montants).toHaveLength(2);
    expect(montants[0].value).toBe('41,24');
    expect(montants[1].value).toBe('');
    // ligne 2 hérite unité/activité
    expect((screen.getAllByLabelText(/Unité du détail/i)[0] as HTMLSelectElement).value).toBe('u-fa');
  });

  it('solde vivant : dépasse en rouge, save désactivé', async () => {
    const { onSaveVentilation } = setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const montants = screen.getAllByLabelText(/Montant/i);
    fireEvent.change(montants[1], { target: { value: '10,00' } });
    await waitFor(() => expect(screen.getByText(/dépasse de 10,00/i)).toBeTruthy());
    expect((screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSaveVentilation).not.toHaveBeenCalled();
  });

  it('équilibré + complet → onSaveVentilation reçoit les ventilations résolues', async () => {
    const { onSaveVentilation } = setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const montants = screen.getAllByLabelText(/Montant/i);
    fireEvent.change(montants[0], { target: { value: '31,24' } });
    fireEvent.change(montants[1], { target: { value: '10,00' } });
    fireEvent.change(screen.getAllByLabelText(/Catégorie/i)[0], { target: { value: 'c-int' } });
    fireEvent.change(screen.getAllByLabelText(/Catégorie/i)[1], { target: { value: 'c-ph' } });
    const save = screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(onSaveVentilation).toHaveBeenCalledTimes(1));
    const arg = onSaveVentilation.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg[0]).toMatchObject({ amount_cents: 3124, category_id: 'c-int', unite_id: 'u-fa', activite_id: 'a-camps' });
  });
});
```

> Adapter les `getByLabelText` au rendu réel de `CategoryPicker` (avec `topIds=[]` il rend un `<select>` de fallback — cf. l'ancien `ventilation-editor.tsx`) et des `NativeSelect`. Les `aria-label` « Unité ligne 1 », « Activité ligne 1 », « Montant », « Unité du détail », « Catégorie » sont posés par le composant.

- [ ] **Step 2 : Lancer, voir échouer** — `cd web && npx vitest run src/components/ecritures/__tests__/imputation-grid.test.tsx` → FAIL (composant absent).

- [ ] **Step 3 : Écrire le composant.** Reprendre la structure de `ventilation-editor.tsx` (imports UI, `newRowId`, état `lines: VentLine[]`), mais :
  - état `ventilated: boolean` initialisé à `startVentilated ?? false`.
  - grille CSS : `grid-template-columns` avec colonnes Montant (`--mcol`) et ✕ (`--xcol`) à **droite** ; à 0 en mono, révélées en ventilé (transition `grid-template-columns`, `@media (prefers-reduced-motion: reduce)` neutralise).
  - en mono : la ligne unique rend Unité/Catégorie/Activité ; leurs `onChange` appellent `onMonoFieldChange(field, value)` (pas d'état local d'imputation à sauver — le panel persiste via PATCH).
  - « + Ajouter un détail » : `setVentilated(true)`, `setLines([{...lines[0], amount: formatAmount(totalCents)}, {id: newRowId(), amount:'', category_id:null, unite_id: lines[0].unite_id, activite_id: lines[0].activite_id}])`.
  - en ventilé : chaque ligne édite `unite_id`/`category_id`/`activite_id`/`amount` dans l'état local `lines` ; « + Ajouter un détail » ajoute une ligne héritant de la dernière.
  - solde vivant via `editorRemainderCents` (classes vert/ambre/rouge).
  - bouton « Enregistrer la ventilation » (`disabled` via `canSaveVentilation`) → `void onSaveVentilation(resolveVentilations(lines))`.
  - `aria-label` : ligne unique « Unité ligne 1 » / « Catégorie ligne 1 » / « Activité ligne 1 » ; lignes de détail « Montant », « Unité du détail », « Catégorie du détail », « Activité du détail ».

- [ ] **Step 4 : Lancer, voir passer** — même commande → PASS. Puis supprimer `ventilation-editor.tsx` + son test, et vérifier qu'aucun import résiduel : `cd web && npx tsc --noEmit`.

- [ ] **Step 5 : Commit** — `git commit -m "feat(ecritures): grille d'imputation unifiée mono/ventilé (montant à droite, unité par ligne)"`

---

### Task 3 : Intégrer la grille dans le panneau + footer + en-tête conditionnel

**Files:**
- Modify: `web/src/components/ecritures/ecriture-inline-panel.tsx`
- Modify: `web/src/components/ecritures/panel-header.tsx`
- Test: `web/src/components/ecritures/__tests__/panel-imputation-v2.test.tsx` (créer)

**Interfaces:**
- Consumes: `ImputationGrid` (Task 2), `panelViewModel`, `computeReadiness`, endpoints `updateEcritureField` (action) et `fetch('/api/ecritures/[id]/ventilations')`.

**Contrat de restructuration :**
1. **En-tête** : `PanelHeader` ne rend le titre/date/montant que si le panneau est **autonome/épinglé** (pas de ligne au-dessus : prop `pinned` = `rowEcriture` absente). En mode inline (`rowEcriture` fournie), n'afficher que le bouton fermer (✕). Ajouter une prop `pinned: boolean` à `PanelHeader`.
2. **Ordre** (mode édition, `vm.mode !== 'readonly'`) : **Imputation** (grille) → **Justificatifs** → **Footer**.
3. **Imputation** : rendre `<ImputationGrid>` en tête. `initialLines` = 1 ligne par membre du groupe (`groupEntries` filtrés sur `ventilation_group_id`, ou `[ecriture]`) : `{ id, amount: formatAmount(m.amount_cents), category_id: m.category_id, unite_id: m.unite_id, activite_id: m.activite_id }`. `totalCents` = Σ membres. `startVentilated` = `isMultiCategory` (≥2 membres). `editable` = `vm.editable`.
   - `onMonoFieldChange` → `await updateEcritureField(ecriture.id, field, value); void refreshRow?.(ecriture.id)`.
   - `onSaveVentilation` → `PUT /api/ecritures/${ecriture.id}/ventilations` (comme l'actuel `handleVentilate`, qui **catche ses erreurs**, affiche `data.error`, puis `router.refresh()`). Ne rend la grille ventilable que si `canVentilate`.
4. **Footer** (bande basse) : à gauche statut — `À compléter`/état + `🏦 banque #<ligne_bancaire_id>` (repris de l'actuel `PanelHeader`/`EcritureStatePair`) ; à droite actions (`PanelValiderButton` si `!comptaweb_ecriture_id`, `PanelMoreMenu`, `DeleteDraftButton` si draft). Retirer le rappel de statut du haut.
5. **`EcritureForm`** reste dans le `<details>` « Éditer les champs » mais **sans** imputation (cf. Task 5) : date/montant/type/carte/notes.
6. La pastille **mode de paiement** est rendue par la ligne (Task 4) ; en mode épinglé, l'ajouter à `PanelHeader` près du montant.

- [ ] **Step 1 : Écrire un test ciblé réel** (`panel-imputation-v2.test.tsx`) — LIRE d'abord `ecriture-inline-panel.tsx` en entier pour construire le harnais de mock (mocks : `next/navigation` `useRouter().refresh`, actions serveur importées, `global.fetch`, `ImputationGrid` peut être partiellement mocké OU rendu réel). Couvrir au minimum :
  - (a) sur un draft éditable, la section **Imputation** apparaît AVANT la section Justificatifs (ordre DOM).
  - (b) le titre/date/montant NE sont PAS répétés dans le corps quand `ecriture` (rowEcriture) est fournie (mode inline).
  - (c) le statut « banque #… » est rendu dans le footer.
  Voir échouer (structure actuelle : justif d'abord, pas de grille en tête), puis brancher.

- [ ] **Step 2 : Lancer, voir échouer** — `cd web && npx vitest run src/components/ecritures/__tests__/panel-imputation-v2.test.tsx`.

- [ ] **Step 3 : Implémenter** la restructuration ci-dessus dans `ecriture-inline-panel.tsx` + `panel-header.tsx` (prop `pinned`). Réutiliser le `handleVentilate` existant pour `onSaveVentilation`.

- [ ] **Step 4 : Lancer les tests** — le fichier ciblé + non-régression `cd web && npx vitest run src/components/ecritures/` + `npx tsc --noEmit` + `npx next build` (garde-fou Next 16). Aucune régression.

- [ ] **Step 5 : Commit** — `git commit -m "feat(ecritures): panneau v2 — imputation en tête, statut en footer, en-tête conditionnel"`

---

### Task 4 : Bandeau replié 2 lignes + pastille mode de paiement

**Files:**
- Modify: `web/src/components/ecritures/ecritures-table.tsx`
- Test: `web/src/components/ecritures/__tests__/ecritures-table-bandeau.test.tsx` (créer si absent, sinon étendre le test table existant)

**Contrat :**
1. Côté droit de la ligne : **montant** (ligne 1) puis un groupe **`mode pill + Valider`** (ligne 2), au lieu d'empiler 3 éléments. La pastille mode remplace le `InlineSelect` mode aujourd'hui dans les chips de gauche — **retirer le mode des chips d'imputation** et le rendre en pastille compacte à droite (éditable via le même `InlineSelect`/`updateEcritureField('mode_paiement_id', …)`).
2. Chip catégorie → « **Catégories multiples** » (non éditable) quand la ligne appartient à un groupe `ventilation_group_id` de ≥2 (utiliser `buildEcritureGroups`/le fait que la ligne soit une entrée d'un groupe ventil ≥2).
3. Le bandeau tient sur **2 lignes** (titre+chips à gauche = 2 lignes ; montant + mode/Valider à droite = 2 lignes).

- [ ] **Step 1 : Écrire/étendre le test** — vérifier que (a) le mode de paiement est rendu à droite (près du montant), pas dans la rangée de chips d'imputation ; (b) une ligne d'un groupe ventilé ≥2 affiche « Catégories multiples » à la place du picker de catégorie. Voir échouer.
- [ ] **Step 2 : Lancer, voir échouer** — `cd web && npx vitest run src/components/ecritures/__tests__/ecritures-table-bandeau.test.tsx`.
- [ ] **Step 3 : Implémenter** le réagencement dans `ecritures-table.tsx` (colonne droite en 2 lignes ; déplacement du mode ; chip « Catégories multiples »).
- [ ] **Step 4 : Lancer** — fichier ciblé + `npx vitest run src/components/ecritures/` + `npx tsc --noEmit`. Aucune régression.
- [ ] **Step 5 : Commit** — `git commit -m "feat(ecritures): bandeau replié 2 lignes + pastille mode de paiement dédiée"`

---

### Task 5 : Nettoyer `EcritureForm` (imputation migrée dans la grille)

**Files:**
- Modify: `web/src/components/ecritures/ecriture-form.tsx`
- Modify/Delete: `web/src/components/ecritures/__tests__/ecriture-form-multicategory.test.tsx` (le hidden `category_id` multiCategory disparaît → test à retirer/adapter)

**Contrat :**
- Retirer d'`EcritureFormFields` les selects d'imputation (Unité, Catégorie, Activité) — désormais rendus par `ImputationGrid`. Conserver les champs d'identité (date, montant, type, carte, notes, mode si présent). Retirer la prop `multiCategory` et le hidden `input[name="category_id"]` associé (l'affichage « Catégories multiples » est géré par la grille et le bandeau).
- Vérifier que `nouvelle-ecriture-wizard.tsx` (autre appelant d'`EcritureFormFields`) reste cohérent : le wizard a sa propre logique de ventilations (`vents`/`setVents`) — s'assurer qu'il ne dépend pas des selects retirés. Si le wizard utilisait ces selects pour le mode mono, adapter (le wizard garde son répéteur propre).

- [ ] **Step 1 : Écrire/adapter le test** — un test vérifiant qu'`EcritureFormFields` ne rend plus de select `category_id`/`unite_id`/`activite_id` (ils vivent dans la grille) et rend toujours les champs d'identité. Retirer `ecriture-form-multicategory.test.tsx` (comportement supprimé) ou le remplacer par ce nouveau test. Voir échouer.
- [ ] **Step 2 : Lancer, voir échouer** — `cd web && npx vitest run src/components/ecritures/__tests__/`.
- [ ] **Step 3 : Implémenter** le retrait des selects d'imputation + `multiCategory` d'`EcritureForm`, adapter le wizard si nécessaire.
- [ ] **Step 4 : Lancer** — `npx vitest run src/components/ecritures/` + `npx vitest run` (suite complète) + `npx tsc --noEmit` + `npx next build`. Aucune régression.
- [ ] **Step 5 : Commit** — `git commit -m "refactor(ecritures): imputation retirée d'EcritureForm (migrée dans la grille)"`

---

## Notes d'exécution

- **Ordre** : 1 (modèle) → 2 (grille) → 3 (panneau) → 4 (bandeau) → 5 (nettoyage). Tasks 3–5 sont de l'intégration (modèle plus capable conseillé).
- **Non-régression** : la ventilation back (#20) ne change pas — seuls le modèle UI et les composants changent. Les tests back (`ecritures-ventilate`, `sync-draft-ventilation`, route) doivent rester verts.
- **Mode épinglé** vs **inline** : bien vérifier les deux rendus du panneau (avec/sans `rowEcriture`).
- Pas de `git push` sans accord.
