# Vue Écritures — Étape 1 : split À traiter / Bouclées + nettoyage colonnes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scinder la liste des écritures en deux sections — « À traiter » (`status ≠ mirror`) en haut, « Bouclées » (`status = mirror`) repliée en bas — et supprimer les colonnes d'état redondantes (`Statut`, `État`, `⚠`).

**Architecture:** Un prédicat pur `isBouclee(status)` (mirror strict, divergent exclu) ; un filtre `bucket` ajouté au service `listEcritures` ; la page rend deux sections via un wrapper client repliable `EcrituresSection`, chacune alimentant l'`EcrituresInfiniteList` existante avec son `bucket`. La `EcrituresTable` perd 3 colonnes. Le drawer d'édition reste inchangé (refondu à l'étape 4).

**Tech Stack:** Next 16 (App Router, RSC + server actions), libsql/Turso, Tailwind, vitest.

**Référence spec:** `docs/superpowers/specs/2026-06-04-vue-ecritures-redesign-design.md`

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `web/src/lib/services/ecritures-status.ts` | Prédicats de statut purs | Modifier : ajouter `isBouclee` |
| `web/src/lib/services/ecritures-status.test.ts` | Tests des prédicats | Modifier : tests `isBouclee` |
| `web/src/lib/services/ecritures.ts` | Service `listEcritures` (SQL) | Modifier : filtre `bucket` |
| `web/src/components/ecritures/ecritures-section.tsx` | Wrapper de section repliable | Créer |
| `web/src/components/ecritures/ecritures-table.tsx` | Tableau | Modifier : retirer 3 colonnes |
| `web/src/app/(app)/ecritures/page.tsx` | Page | Modifier : deux sections |

**Réalité des tests :** dans ce codebase, la logique pure et les services testables sans `getDb()` sont couverts par vitest ; les composants UI ne sont pas unit-testés (`EcrituresTable`, `page.tsx` n'ont pas de tests). `listEcritures` utilise `getDb()` au niveau module → non injectable, donc non unit-testé. On suit ce pattern : TDD réel sur `isBouclee` (Task 1) ; le filtre SQL et l'UI sont vérifiés par `tsc` + `eslint` + contrôle visuel.

---

### Task 1 : Prédicat pur `isBouclee`

**Files:**
- Modify: `web/src/lib/services/ecritures-status.ts`
- Test: `web/src/lib/services/ecritures-status.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `web/src/lib/services/ecritures-status.test.ts` :

```ts
import { isBouclee } from './ecritures-status';

describe('isBouclee — frontière À traiter / Bouclées (mirror strict)', () => {
  it('mirror → bouclée', () => {
    expect(isBouclee('mirror')).toBe(true);
  });
  it('divergent → PAS bouclée (demande un arbitrage humain)', () => {
    expect(isBouclee('divergent')).toBe(false);
  });
  it.each(['draft', 'pending_cw', 'pending_sync'])('%s → PAS bouclée', (s) => {
    expect(isBouclee(s)).toBe(false);
  });
});
```

> Si le fichier de test n'importe pas déjà `describe/it/expect`, vérifier l'en-tête : `import { describe, it, expect } from 'vitest';` (présent en haut du fichier). Ne pas dupliquer l'import si déjà là — ajouter seulement `import { isBouclee } from './ecritures-status';` s'il manque.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd web && npx vitest run src/lib/services/ecritures-status.test.ts`
Expected: FAIL — `isBouclee is not a function` / export introuvable.

- [ ] **Step 3 : Implémenter le prédicat**

Ajouter dans `web/src/lib/services/ecritures-status.ts`, après la fonction `isMirrorStatus` :

```ts
// Frontière stricte du split UI « À traiter » / « Bouclées » :
// seules les écritures `mirror` (miroir CW propre) sont bouclées.
// Les `divergent` restent « À traiter » : un écart Baloo ↔ CW a été
// détecté et demande un arbitrage humain — surtout pas les classer.
export function isBouclee(status: string): boolean {
  return status === 'mirror';
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd web && npx vitest run src/lib/services/ecritures-status.test.ts`
Expected: PASS (tous les cas).

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/ecritures-status.ts web/src/lib/services/ecritures-status.test.ts
git commit -m "feat(ecritures): isBouclee — frontière mirror strict du split"
```

---

### Task 2 : Filtre `bucket` dans le service `listEcritures`

**Files:**
- Modify: `web/src/lib/services/ecritures.ts`

- [ ] **Step 1 : Ajouter le champ au type `EcritureFilters`**

Dans `web/src/lib/services/ecritures.ts`, dans l'interface `EcritureFilters` (vers la ligne 14), ajouter après le bloc `status?` / `statusIn?` :

```ts
  // Split UI : 'a_traiter' = tout sauf mirror ; 'bouclees' = mirror strict.
  // Orthogonal à status/statusIn (qui filtrent un statut précis).
  bucket?: 'a_traiter' | 'bouclees';
```

- [ ] **Step 2 : Câbler la condition SQL**

Dans la même fonction `listEcritures`, juste après le bloc `if (filters.statusIn ...) else if (filters.status ...)` (vers la ligne 112, avant `if (filters.search)`), ajouter :

```ts
  if (filters.bucket === 'bouclees') {
    conditions.push("e.status = 'mirror'");
  } else if (filters.bucket === 'a_traiter') {
    conditions.push("e.status <> 'mirror'");
  }
```

> Pas de placeholder/valeur : le littéral `'mirror'` est sûr (constante, pas d'entrée utilisateur), cohérent avec les autres requêtes « mirror strict » du codebase (cf. commentaire dans `ecritures-status.ts`).

- [ ] **Step 3 : Vérifier le typecheck**

Run: `cd web && npx tsc --noEmit -p tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/ecritures.ts
git commit -m "feat(ecritures): filtre bucket (a_traiter / bouclees) dans listEcritures"
```

---

### Task 3 : Composant `EcrituresSection` (section repliable)

**Files:**
- Create: `web/src/components/ecritures/ecritures-section.tsx`

- [ ] **Step 1 : Créer le composant**

Créer `web/src/components/ecritures/ecritures-section.tsx` :

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

// En-tête de section repliable au-dessus d'une liste d'écritures.
// « Bouclées » est repliée par défaut (longue) ; « À traiter » ouverte.
// Le contenu reste monté mais masqué via `hidden` quand replié — ainsi
// le sentinel d'infinite scroll de la liste ne se déclenche pas tant que
// la section est fermée (display:none ⇒ pas d'intersection).
export function EcrituresSection({
  title,
  count,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  count: number;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 mb-3 text-left group/sec"
      >
        <ChevronDown
          size={16}
          strokeWidth={2.25}
          className={`text-fg-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        <span className="text-[12.5px] text-fg-muted tabular-nums">
          {count} écriture{count > 1 ? 's' : ''}
        </span>
      </button>
      <div hidden={collapsed}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 2 : Vérifier typecheck + lint**

Run: `cd web && npx tsc --noEmit -p tsconfig.json && npx eslint src/components/ecritures/ecritures-section.tsx`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecritures-section.tsx
git commit -m "feat(ecritures): EcrituresSection — en-tête de section repliable"
```

---

### Task 4 : Retirer les colonnes `Statut` / `⚠` / `État` de `EcrituresTable`

**Files:**
- Modify: `web/src/components/ecritures/ecritures-table.tsx`

Après cette tâche, le tableau a 6 colonnes : checkbox, Date, Description, Montant, Unité, Catégorie.

- [ ] **Step 1 : Nettoyer les imports désormais inutilisés**

Remplacer la ligne d'import lucide (ligne 6) :

```tsx
import { CheckCircle2, Circle, Clock, Landmark, Layers, Paperclip, MinusCircle } from 'lucide-react';
```

par (seuls `Landmark` et `Layers` servent encore, dans l'en-tête de groupe) :

```tsx
import { Landmark, Layers } from 'lucide-react';
```

Supprimer aussi l'import `EcritureStatePair` (ligne 8) :

```tsx
import { EcritureStatePair } from '@/components/shared/status-badge';
```

→ retirer cette ligne entièrement.

- [ ] **Step 2 : Retirer les 3 `<TableHead>` de l'en-tête**

Dans le `<TableHeader>`, supprimer ces trois lignes :

```tsx
            <TableHead className="w-[108px] whitespace-nowrap">Statut</TableHead>
            <TableHead className="w-[44px] text-center whitespace-nowrap" title="Champs manquants">⚠</TableHead>
            <TableHead className="w-[64px] text-center whitespace-nowrap" title="Source / Comptaweb / Justificatif">État</TableHead>
```

L'en-tête se termine désormais à la ligne `<TableHead className="w-[150px]">Catégorie</TableHead>`.

- [ ] **Step 3 : Corriger le `colSpan` de l'en-tête de groupe**

Dans le rendu `item.kind === 'header'`, la dernière cellule couvrait les colonnes unité→état avec `colSpan={5}`. Il n'y a plus que unité + catégorie. Remplacer :

```tsx
                  <TableCell colSpan={5} className="text-xs text-muted-foreground whitespace-nowrap">
```

par :

```tsx
                  <TableCell colSpan={2} className="text-xs text-muted-foreground whitespace-nowrap">
```

(Les autres cellules de l'en-tête de groupe — checkbox, `colSpan={2}` date+description, montant — sont inchangées : 1 + 2 + 1 + 2 = 6 colonnes.)

- [ ] **Step 4 : Retirer les 3 `<TableCell>` du corps de ligne**

Dans le rendu d'une ligne (`item.ecriture`), supprimer ces trois blocs, dans l'ordre :

Le bloc Statut :

```tsx
                <TableCell className="whitespace-nowrap">
                  <EcritureStatePair
                    hasJustif={!!e.has_justificatif}
                    comptawebSynced={e.comptaweb_synced === 1}
                  />
                </TableCell>
```

Le bloc `⚠` (missing_fields) :

```tsx
                <TableCell className="text-xs text-center whitespace-nowrap">
                  {e.missing_fields && e.missing_fields.length > 0 ? (
                    <span
                      className="inline-block rounded bg-orange-100 text-orange-800 px-1.5 py-0.5"
                      title={`Champs manquants : ${e.missing_fields.join(', ')}`}
                    >
                      {e.missing_fields.length}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
```

Le bloc État (icônes) — toute la `<TableCell className="text-center whitespace-nowrap">` contenant le `<span className="inline-flex items-center gap-2">` avec les icônes CW/justif (du `CheckCircle2`/`Circle` jusqu'au `Paperclip` final). Supprimer la cellule entière.

La ligne se termine désormais après la `<TableCell>` Catégorie.

- [ ] **Step 5 : Corriger le `colSpan` de la ligne vide**

Remplacer :

```tsx
            <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Aucune écriture</TableCell></TableRow>
```

par :

```tsx
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Aucune écriture</TableCell></TableRow>
```

- [ ] **Step 6 : Vérifier typecheck + lint (détecte tout import/variable orphelin)**

Run: `cd web && npx tsc --noEmit -p tsconfig.json && npx eslint src/components/ecritures/ecritures-table.tsx`
Expected: aucune erreur (ni « unused import », ni colSpan typé).

- [ ] **Step 7 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecritures-table.tsx
git commit -m "feat(ecritures): retire les colonnes Statut/⚠/État (la section = le statut)"
```

---

### Task 5 : Rendre deux sections dans la page

**Files:**
- Modify: `web/src/app/(app)/ecritures/page.tsx`

- [ ] **Step 1 : Charger les deux buckets**

Dans `web/src/app/(app)/ecritures/page.tsx`, le `filters` actuel (lignes 28-40) sert de base commune. Remplacer l'appel unique `listEcritures(filters)` dans le `Promise.all` (ligne 59) par deux appels distincts. Concrètement :

1. Renommer la destructuration. Remplacer la ligne :

```tsx
    { ecritures, total },
```

par :

```tsx
    aTraiter,
    bouclees,
```

2. Remplacer la ligne d'appel `listEcritures(filters),` par :

```tsx
    listEcritures({ ...filters, bucket: 'a_traiter' }),
    listEcritures({ ...filters, bucket: 'bouclees' }),
```

(`aTraiter` et `bouclees` sont chacun de type `{ ecritures, total }`.)

- [ ] **Step 2 : Importer `EcrituresSection`**

Ajouter en haut, près des autres imports de composants écritures :

```tsx
import { EcrituresSection } from '@/components/ecritures/ecritures-section';
```

- [ ] **Step 3 : Remplacer le compteur + la liste unique par deux sections**

Remplacer ce bloc :

```tsx
      <p className="text-sm text-muted-foreground mb-4">{total} écriture{total > 1 ? 's' : ''}</p>

      <EcrituresInfiniteList
        key={JSON.stringify(filters)}
        initialEcritures={ecritures}
        total={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        categories={categories}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
      />
```

par :

```tsx
      <EcrituresSection title="À traiter" count={aTraiter.total} defaultCollapsed={false}>
        <EcrituresInfiniteList
          key={`a_traiter:${JSON.stringify(filters)}`}
          initialEcritures={aTraiter.ecritures}
          total={aTraiter.total}
          pageSize={PAGE_SIZE}
          filters={{ ...filters, bucket: 'a_traiter' }}
          categories={categories}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
        />
      </EcrituresSection>

      <EcrituresSection title="Bouclées" count={bouclees.total} defaultCollapsed={true}>
        <EcrituresInfiniteList
          key={`bouclees:${JSON.stringify(filters)}`}
          initialEcritures={bouclees.ecritures}
          total={bouclees.total}
          pageSize={PAGE_SIZE}
          filters={{ ...filters, bucket: 'bouclees' }}
          categories={categories}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
        />
      </EcrituresSection>
```

> `EcritureFilters` accepte déjà `bucket` (Task 2). `EcrituresInfiniteList` transmet `filters` à `fetchEcrituresPage` ⇒ la pagination respecte le bucket sans autre changement.

- [ ] **Step 4 : Vérifier typecheck + lint**

Run: `cd web && npx tsc --noEmit -p tsconfig.json && npx eslint "src/app/(app)/ecritures/page.tsx"`
Expected: aucune erreur. (Si `total`/`ecritures` sont signalés non utilisés ailleurs, vérifier qu'aucune autre référence ne subsiste — il ne doit plus y en avoir.)

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "web/src/app/(app)/ecritures/page.tsx"
git commit -m "feat(ecritures): deux sections À traiter / Bouclées (repliée par défaut)"
```

---

### Task 6 : Vérification visuelle + suite de tests

**Files:** aucun (vérification).

- [ ] **Step 1 : Lancer toute la suite de tests**

Run: `cd web && npx vitest run`
Expected: PASS (aucune régression ; le nouveau test `isBouclee` inclus).

- [ ] **Step 2 : Contrôle visuel via l'app**

Lancer l'app (skill `run` ou `cd web && pnpm dev`) et ouvrir `/ecritures`. Vérifier :
- Deux sections : « À traiter » ouverte en haut, « Bouclées » repliée en bas avec son compteur.
- Déplier « Bouclées » : la liste apparaît, l'infinite scroll charge la suite en scrollant.
- Le tableau n'a plus que 6 colonnes (plus de Statut / ⚠ / État) et **pas de scroll horizontal** (acquis de l'étape précédente conservé).
- Les en-têtes de groupe (ligne bancaire / écriture CW) restent alignés (colSpan corrigé).
- Les filtres (recherche, avancés, tabs) s'appliquent bien aux deux sections.
- Clic sur une ligne : le drawer d'édition s'ouvre toujours (inchangé à cette étape).

- [ ] **Step 3 : (rien à committer si tout est vert)**

Si un ajustement visuel est nécessaire, le faire puis committer avec un message `fix(ecritures): …`.

---

## Self-review (auteur du plan)

- **Couverture spec (étape 1 uniquement)** : split À traiter/Bouclées (Tasks 1,2,5) ✓ ; repli Bouclées par défaut (Task 3,5) ✓ ; suppression colonnes Statut/État/⚠ (Task 4) ✓ ; frontière mirror strict, divergent en haut (Task 1) ✓. Header financier / bannière / accordéon inline = **étapes 2-4, hors de ce plan** (intentionnel).
- **Placeholders** : aucun « TBD » ; chaque step montre le code exact.
- **Cohérence des noms** : `isBouclee` (Task 1) réutilisé conceptuellement ; champ `bucket: 'a_traiter' | 'bouclees'` identique entre Task 2 (type), Task 5 (usage). `EcrituresSection` props (`title`, `count`, `defaultCollapsed`) identiques entre Task 3 (déf) et Task 5 (usage).
- **Tests** : TDD réel sur le seul élément testable proprement (`isBouclee`) ; le reste vérifié par `tsc`/`eslint`/visuel, conformément à l'absence de tests UI dans le codebase.

## Suite (plans ultérieurs)

- **Étape 2** : header financier (solde de l'exercice + entrées/sorties du mois, filtre-aware).
- **Étape 3** : bannière de correspondance dépôt/remboursement + « Lier » en un clic.
- **Étape 4** : lignes aérées + accordéon inline + suppression du drawer + gate `computeReadiness`.
