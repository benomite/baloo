# Vue Écritures — Étape 2 : header financier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un bandeau financier en tête de la vue Écritures : solde de l'exercice + entrées/sorties du mois courant.

**Architecture:** Une fonction service `getEcrituresHeaderTotals` (2 agrégats SQL : exercice + mois) ; un composant de présentation `EcrituresFinancialHeader` (RSC pur, reçoit les centimes en props) ; câblage dans `page.tsx` (calcul exercice + mois côté serveur, rendu sous le `PageHeader`).

**Tech Stack:** Next 16 (RSC), libsql/Turso, Tailwind, vitest.

**Référence spec:** `docs/superpowers/specs/2026-06-04-vue-ecritures-redesign-design.md`

## ⚠️ Écart assumé vs spec (à valider par l'utilisateur)

Le spec disait « les totaux se recalculent selon le filtre actif ». Ce plan livre un header **global (non filter-aware)** :
- **Solde de l'exercice** : recettes − dépenses sur l'exercice SGDF courant, à l'échelle du groupe. C'est l'ancre stable « où en est le groupe » — un solde qui changerait à chaque filtre serait trompeur.
- **Entrées / Sorties du mois** : sommes recettes / dépenses du mois calendaire courant, à l'échelle du groupe.

Raison : `getOverview` / les agrégats existants ne filtrent que par exercice ; rendre le header filter-aware imposerait d'extraire la construction du `WHERE` de `listEcritures` (refacto du chemin critique). YAGNI pour l'étape 2. Le filter-aware reste possible en itération ultérieure.

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `web/src/lib/services/overview.ts` | Agrégats financiers | Modifier : ajouter `getEcrituresHeaderTotals` |
| `web/src/components/ecritures/ecritures-financial-header.tsx` | Bandeau de présentation | Créer |
| `web/src/app/(app)/ecritures/page.tsx` | Page | Modifier : calcul + rendu du header |

**Réalité des tests :** `getEcrituresHeaderTotals` utilise `getDb()` (global, non injectable) comme `getOverview` → non unit-testé, conforme au pattern du fichier. Les helpers purs réutilisés (`currentExercice`, `exerciceBounds`) sont déjà couverts. Vérification : `tsc` + `eslint` + contrôle visuel. Pas de TDD pertinent ici (aucune logique pure nouvelle).

---

### Task 1 : Service `getEcrituresHeaderTotals`

**Files:**
- Modify: `web/src/lib/services/overview.ts`

- [ ] **Step 1 : Ajouter l'interface + la fonction**

À la fin de `web/src/lib/services/overview.ts`, ajouter :

```ts
export interface EcrituresHeaderTotals {
  exercice: string;
  soldeExerciceCents: number;
  mois: string; // 'YYYY-MM'
  entreesMoisCents: number;
  sortiesMoisCents: number;
}

// Totaux du bandeau de la vue Écritures. `now` (exercice + mois) est
// calculé par l'appelant (page RSC) — pas de `new Date()` ici, pour que
// la fonction reste déterministe. Volontairement GLOBAL (pas filter-aware) :
// le solde de l'exercice est une ancre stable, indépendante des filtres UI.
export async function getEcrituresHeaderTotals(
  { groupId }: OverviewContext,
  now: { exercice: string; mois: string },
): Promise<EcrituresHeaderTotals> {
  const db = getDb();
  const { start, end } = exerciceBounds(now.exercice);

  const exo = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'recette' THEN amount_cents ELSE 0 END), 0) as rec,
         COALESCE(SUM(CASE WHEN type = 'depense' THEN amount_cents ELSE 0 END), 0) as dep
       FROM ecritures
       WHERE group_id = ? AND date_ecriture >= ? AND date_ecriture <= ?`,
    )
    .get<{ rec: number; dep: number }>(groupId, start, end);

  const mois = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'recette' THEN amount_cents ELSE 0 END), 0) as rec,
         COALESCE(SUM(CASE WHEN type = 'depense' THEN amount_cents ELSE 0 END), 0) as dep
       FROM ecritures
       WHERE group_id = ? AND date_ecriture LIKE ?`,
    )
    .get<{ rec: number; dep: number }>(groupId, `${now.mois}%`);

  const exoRec = exo?.rec ?? 0;
  const exoDep = exo?.dep ?? 0;
  return {
    exercice: now.exercice,
    soldeExerciceCents: exoRec - exoDep,
    mois: now.mois,
    entreesMoisCents: mois?.rec ?? 0,
    sortiesMoisCents: mois?.dep ?? 0,
  };
}
```

> `OverviewContext`, `exerciceBounds`, `currentExercice` sont déjà définis/exportés en haut du fichier — ne pas les redéclarer.

- [ ] **Step 2 : Typecheck**

Run: `cd web && npx tsc --noEmit -p tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/overview.ts
git commit -m "feat(ecritures): getEcrituresHeaderTotals — solde exercice + flux du mois"
```

---

### Task 2 : Composant `EcrituresFinancialHeader`

**Files:**
- Create: `web/src/components/ecritures/ecritures-financial-header.tsx`

- [ ] **Step 1 : Créer le composant (RSC pur, pas de 'use client')**

Créer `web/src/components/ecritures/ecritures-financial-header.tsx` :

```tsx
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Amount } from '@/components/shared/amount';

// Bandeau financier en tête de la vue Écritures. Présentation pure :
// reçoit les centimes en props (calculés côté serveur). Global, pas
// filter-aware (cf. plan étape 2).
export function EcrituresFinancialHeader({
  soldeExerciceCents,
  exercice,
  entreesMoisCents,
  sortiesMoisCents,
}: {
  soldeExerciceCents: number;
  exercice: string;
  entreesMoisCents: number;
  sortiesMoisCents: number;
}) {
  return (
    <div className="mb-6 rounded-xl border border-border-soft bg-bg-elevated px-5 py-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-fg-subtle font-medium">
          Solde de l&apos;exercice {exercice}
        </div>
        <div className="mt-1 font-display text-[26px] leading-none text-fg">
          <Amount cents={soldeExerciceCents} tone="signed" />
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center size-7 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30">
            <ArrowUpRight size={15} strokeWidth={2.25} />
          </span>
          <div>
            <div className="text-[11px] text-fg-subtle">Entrées du mois</div>
            <div className="font-semibold tabular-nums text-fg">
              <Amount cents={entreesMoisCents} tone="positive" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center size-7 rounded-full bg-red-50 text-red-600 dark:bg-red-950/30">
            <ArrowDownRight size={15} strokeWidth={2.25} />
          </span>
          <div>
            <div className="text-[11px] text-fg-subtle">Sorties du mois</div>
            <div className="font-semibold tabular-nums text-fg">
              <Amount cents={sortiesMoisCents} tone="negative" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Typecheck + lint**

Run: `cd web && npx tsc --noEmit -p tsconfig.json && npx eslint src/components/ecritures/ecritures-financial-header.tsx`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecritures-financial-header.tsx
git commit -m "feat(ecritures): EcrituresFinancialHeader — bandeau solde + flux du mois"
```

---

### Task 3 : Câbler le header dans la page

**Files:**
- Modify: `web/src/app/(app)/ecritures/page.tsx`

- [ ] **Step 1 : Imports**

Ajouter en haut de `web/src/app/(app)/ecritures/page.tsx` :

```tsx
import { getEcrituresHeaderTotals, currentExercice } from '@/lib/services/overview';
import { EcrituresFinancialHeader } from '@/components/ecritures/ecritures-financial-header';
```

- [ ] **Step 2 : Calculer exercice + mois et charger les totaux**

Juste après `const params = await searchParams;` (avant la construction de `filters`), ajouter :

```tsx
  const exercice = currentExercice();
  const mois = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
```

Puis ajouter l'appel dans le `Promise.all([...])`. Ajouter une nouvelle entrée à la FIN du tableau d'appels (après `listLinkSuggestions(ctx.groupId),`) :

```tsx
    getEcrituresHeaderTotals({ groupId: ctx.groupId }, { exercice, mois }),
```

et la variable correspondante à la FIN de la destructuration (après `linkSuggestions,`) :

```tsx
    headerTotals,
```

(L'ordre des entrées et des variables destructurées dans un `Promise.all` doit correspondre — ajoute les deux en dernière position.)

- [ ] **Step 3 : Rendre le header sous le PageHeader**

Repère la fermeture `</PageHeader>` (vers la ligne 103). Juste APRÈS, et AVANT le bloc des tabs (`{/* Tabs underline ... */}` / `<div className="mb-4 flex flex-wrap gap-6 border-b">`), insérer :

```tsx
      <EcrituresFinancialHeader
        soldeExerciceCents={headerTotals.soldeExerciceCents}
        exercice={headerTotals.exercice}
        entreesMoisCents={headerTotals.entreesMoisCents}
        sortiesMoisCents={headerTotals.sortiesMoisCents}
      />
```

- [ ] **Step 4 : Typecheck + lint**

Run: `cd web && npx tsc --noEmit -p tsconfig.json && npx eslint "src/app/(app)/ecritures/page.tsx"`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "web/src/app/(app)/ecritures/page.tsx"
git commit -m "feat(ecritures): affiche le bandeau financier en tête de la vue"
```

---

### Task 4 : Vérification

**Files:** aucun.

- [ ] **Step 1 : Suite de tests complète**

Run: `cd web && npx vitest run`
Expected: PASS (aucune régression).

- [ ] **Step 2 : Contrôle visuel**

Lancer l'app, ouvrir `/ecritures`. Vérifier :
- Bandeau en tête : « Solde de l'exercice YYYY-YYYY » + montant signé (rouge si négatif, vert si positif).
- « Entrées du mois » en vert (préfixe +), « Sorties du mois » en rouge (préfixe −).
- Le bandeau s'affiche sous le titre, au-dessus des tabs, et reste lisible en responsive (empilage mobile).
- Cohérence des chiffres avec le dashboard / `vue_ensemble` (même solde d'exercice).

---

## Self-review (auteur du plan)

- **Couverture spec (étape 2)** : solde de l'exercice (Task 1,2,3) ✓ ; entrées/sorties du mois (Task 1,2,3) ✓. **Écart explicite** : non filter-aware (cf. encart en tête) — à valider par l'utilisateur avant exécution.
- **Placeholders** : aucun ; code complet à chaque step.
- **Cohérence des noms** : `EcrituresHeaderTotals` / `getEcrituresHeaderTotals` (Task 1) réutilisés en Task 3 ; props `soldeExerciceCents` / `exercice` / `entreesMoisCents` / `sortiesMoisCents` identiques entre Task 2 (déf) et Task 3 (usage) et Task 1 (retour).
- **Tests** : pas de TDD (aucune logique pure nouvelle ; agrégats DB non injectables comme le reste de `overview.ts`). Vérif `tsc`/`eslint`/`vitest`/visuel.

## Suite

- Étape 3 : bannière de correspondance dépôt/remboursement + « Lier » en un clic.
- Étape 4 : lignes aérées + accordéon inline + suppression du drawer + gate `computeReadiness`.
