# Vue Écritures — Étape 4a : accordéon inline (remplace le drawer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand on clique une écriture, déplier son panneau d'édition **sur place** dans le tableau (au lieu du drawer slide-over), sans perdre le fil. Supprimer le `Drawer`. La page `/ecritures/[id]` reste le filet.

**Architecture:** On extrait le corps de `EcritureDrawer` dans un composant `EcritureInlinePanel` (mêmes sous-composants : `ReadinessBanner`, `EcritureForm`, `JustificatifsCard`, cycle de vie), en remplaçant le wrapper `<Drawer>` par un panneau inline + un bouton replier. Le mécanisme de chargement serveur (`?detail=id` → la page charge `detailEcriture` / `detailJustifs` / `detailPendingDepots`) est **inchangé** : on passe juste ce bundle au tableau, qui rend le panneau sous la ligne dont l'id correspond. Aucune réécriture de logique d'édition → risque maîtrisé sur le chemin critique.

**Tech Stack:** Next 16 (RSC + server actions), Tailwind, vitest.

**Référence spec:** `docs/superpowers/specs/2026-06-04-vue-ecritures-redesign-design.md` (étape 4).

**Commandes :** toujours depuis `web/` avec le binaire local — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`, `… ./node_modules/.bin/eslint <files>`, `… ./node_modules/.bin/vitest run`.

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `web/src/components/ecritures/ecriture-inline-panel.tsx` | Panneau d'édition inline | Créer (dérivé du drawer) |
| `web/src/app/(app)/ecritures/page.tsx` | Page | Modifier : passer le bundle detail + topCategoryIds aux listes ; retirer le drawer |
| `web/src/components/ecritures/ecritures-infinite-list.tsx` | Liste | Modifier : transmettre le bundle detail + topCategoryIds |
| `web/src/components/ecritures/ecritures-table.tsx` | Tableau | Modifier : rendre le panneau inline + toggle au clic |
| `web/src/components/ecritures/ecriture-drawer.tsx` | Ancien drawer | Supprimer (dernière task) |

**Réalité des tests :** pas de logique pure nouvelle → pas de TDD. Vérification par `tsc` + `eslint` + suite `vitest` (non-régression) + contrôle visuel. Chemin critique → revue soignée.

**Comportement assumé :** le panneau ne s'affiche que si la ligne `?detail=id` est dans une page déjà chargée (clic sur une ligne visible ⇒ toujours le cas). Un deep-link `?detail=id` vers une écriture non encore scrollée n'ouvre pas le panneau inline (la page `/ecritures/[id]` reste l'accès direct). Régression mineure acceptée vs le drawer page-level.

---

### Task 1 : Composant `EcritureInlinePanel` (dérivé du drawer)

**Files:**
- Create: `web/src/components/ecritures/ecriture-inline-panel.tsx`

- [ ] **Step 1 : Copier le drawer comme base**

Lire `web/src/components/ecritures/ecriture-drawer.tsx` en entier. Créer `ecriture-inline-panel.tsx` en **repartant de ce fichier**, avec ces transformations (le CORPS — origine bancaire, `ReadinessBanner`, `EcritureForm`, `JustificatifsCard`, bloc cycle de vie — est conservé **verbatim**) :

1. Garder `'use client';`.
2. **Imports** : retirer `import { Drawer } from '@/components/ui/drawer';`. Ajouter `X` à l'import `lucide-react` existant (les autres icônes `AlertTriangle, CheckCircle2, ExternalLink, Landmark, Lock` restent). Tout le reste des imports est inchangé.
3. **Renommer** la fonction exportée `EcritureDrawer` → `EcritureInlinePanel` (props identiques, mêmes types).
4. **Renommer** `const close = ...` → `const collapse = ...` (corps identique : supprime `detail` des searchParams et `router.push`).
5. **Remplacer le wrapper.** Le drawer rend actuellement :

```tsx
    <Drawer
      open
      onClose={close}
      title={ /* … id + EcritureStatePair + Amount … */ }
    >
      {/* Eyebrow : description + date + lien deep */}
      … tout le corps …
    </Drawer>
```

Remplacer par un panneau inline. Le `<TableRow>` au-dessus montre déjà date / description / montant, donc l'en-tête du panneau est compact (id + statut + liens + replier) ; le reste du corps est inchangé :

```tsx
    <div className="rounded-xl border border-border-soft bg-bg-elevated shadow-sm p-4 my-1 text-left">
      {/* En-tête compact du panneau */}
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border-soft">
        <Link
          href={`/ecritures/${ecriture.id}`}
          className="font-mono text-[11.5px] text-fg-subtle hover:text-brand hover:underline shrink-0"
          title={`Ouvrir ${ecriture.id} en page complète`}
        >
          {ecriture.id}
        </Link>
        <EcritureStatePair
          hasJustif={!!ecriture.has_justificatif}
          comptawebSynced={ecriture.comptaweb_synced === 1}
        />
        <Link
          href={`/ecritures/${ecriture.id}`}
          className="inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline"
        >
          <ExternalLink size={10} strokeWidth={2} />
          Page complète
        </Link>
        <button
          type="button"
          onClick={collapse}
          aria-label="Replier"
          className="ml-auto inline-flex items-center justify-center size-6 rounded text-fg-subtle hover:bg-muted hover:text-fg transition-colors"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      {/* === CORPS VERBATIM DU DRAWER (à partir de "Origine bancaire") === */}
      {/* Origine bancaire */}
      {ecriture.ligne_bancaire_id && ( /* … Alert inchangée … */ )}

      <ReadinessBanner readiness={readiness} justifMissing={justifMissing} />

      <EcritureForm
        action={updateAction}
        categories={categories}
        topCategoryIds={topCategoryIds}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
        ecriture={ecriture}
      />

      <div className="mt-5">
        <JustificatifsCard … inchangé … />
      </div>

      <div className="mt-6 pt-4 border-t border-border-soft">
        … bloc cycle de vie inchangé …
      </div>
    </div>
```

> En clair : on remplace les balises `<Drawer …>` / `</Drawer>` et le bloc `title={…}` + l'« eyebrow » description/date (redondants avec la ligne) par le `<div>` panneau + l'en-tête compact ci-dessus. **Tout le reste du corps (origine bancaire, ReadinessBanner, EcritureForm, JustificatifsCard, cycle de vie) et la fonction `ReadinessBanner` en bas de fichier sont copiés tels quels.**

6. Garder la fonction `ReadinessBanner` (et son rendu) **verbatim** en bas du fichier.

- [ ] **Step 2 : Vérifier typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/ecriture-inline-panel.tsx`
Expected: aucune erreur. (Si un import devient inutilisé — ex. une icône — le retirer.)

- [ ] **Step 3 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecriture-inline-panel.tsx
git commit -m "feat(ecritures): EcritureInlinePanel — corps du drawer en panneau inline"
```

---

### Task 2 : page.tsx — passer le bundle detail aux listes, retirer le drawer

**Files:**
- Modify: `web/src/app/(app)/ecritures/page.tsx`

- [ ] **Step 1 : Imports**

Retirer l'import `EcritureDrawer` :

```tsx
import { EcritureDrawer } from '@/components/ecritures/ecriture-drawer';
```

(On ne l'importe plus ; le rendu inline se fait dans le tableau.)

- [ ] **Step 2 : Construire l'objet `detail` à passer aux listes**

Le `Promise.all` existant charge déjà `detailEcriture`, `detailJustifs`, `detailPendingDepots` quand `?detail` est présent. Après le `Promise.all` (et les `map` de pools de l'étape 3), construire un bundle optionnel :

```tsx
  const detail =
    detailEcriture && detailJustifs && detailPendingDepots
      ? { ecriture: detailEcriture, justifsBundle: detailJustifs, pendingDepots: detailPendingDepots }
      : null;
```

- [ ] **Step 3 : Passer `detail` + `topCategoryIds` aux DEUX `<EcrituresInfiniteList>`**

Ajouter ces deux props aux deux instances (sections « À traiter » et « Bouclées »), en plus des props existantes :

```tsx
          detail={detail}
          topCategoryIds={topCategoryIds}
```

- [ ] **Step 4 : Supprimer le bloc de rendu du drawer**

Supprimer entièrement le bloc JSX final :

```tsx
      {detailEcriture && detailJustifs && detailPendingDepots && (
        <EcritureDrawer
          ecriture={detailEcriture}
          justifsBundle={detailJustifs}
          pendingDepots={detailPendingDepots}
          categories={categories}
          topCategoryIds={topCategoryIds}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
        />
      )}
```

- [ ] **Step 5 : Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint "src/app/(app)/ecritures/page.tsx"`
Expected: aucune erreur. (`topCategoryIds` reste utilisé — désormais passé aux listes. `detailEcriture`/`detailJustifs`/`detailPendingDepots` restent utilisés via `detail`.)

- [ ] **Step 6 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "web/src/app/(app)/ecritures/page.tsx"
git commit -m "feat(ecritures): page passe le bundle detail aux listes (au lieu du drawer)"
```

---

### Task 3 : ecritures-infinite-list.tsx — transmettre le bundle

**Files:**
- Modify: `web/src/components/ecritures/ecritures-infinite-list.tsx`

- [ ] **Step 1 : Types + props**

Ajouter les imports de types nécessaires en haut :

```tsx
import type { EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import type { DepotEnriched } from '@/lib/services/depots';
```

Ajouter au `interface Props` :

```tsx
  detail: { ecriture: Ecriture; justifsBundle: EcritureJustifsBundle; pendingDepots: DepotEnriched[] } | null;
  topCategoryIds: string[];
```

(`Ecriture` est déjà importé dans ce fichier.)

- [ ] **Step 2 : Déstructurer et transmettre à `EcrituresTable`**

Déstructurer `detail` et `topCategoryIds` dans la signature du composant (avec les autres props), puis les passer à `<EcrituresTable ... />` :

```tsx
        detail={detail}
        topCategoryIds={topCategoryIds}
```

- [ ] **Step 3 : Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/ecritures-infinite-list.tsx`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecritures-infinite-list.tsx
git commit -m "feat(ecritures): infinite-list transmet le bundle detail au tableau"
```

---

### Task 4 : ecritures-table.tsx — rendre le panneau inline + toggle au clic

**Files:**
- Modify: `web/src/components/ecritures/ecritures-table.tsx`

- [ ] **Step 1 : Imports + types**

Ajouter :

```tsx
import { EcritureInlinePanel } from './ecriture-inline-panel';
import type { EcritureJustifsBundle } from '@/lib/queries/justificatifs';
import type { DepotEnriched } from '@/lib/services/depots';
```

Ajouter au `interface Props` :

```tsx
  detail: { ecriture: Ecriture; justifsBundle: EcritureJustifsBundle; pendingDepots: DepotEnriched[] } | null;
  topCategoryIds: string[];
```

Déstructurer `detail, topCategoryIds` dans la signature de `EcrituresTable`.

- [ ] **Step 2 : Toggle au clic de ligne**

Repérer `onRowClick` (vers le haut du composant) :

```tsx
  const onRowClick = (id: string) => (ev: React.MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.button === 1) {
      window.open(`/ecritures/${id}`, '_blank');
      return;
    }
    router.push(detailHref(id), { scroll: false });
  };
```

Le remplacer pour replier si la ligne est déjà ouverte :

```tsx
  const onRowClick = (id: string) => (ev: React.MouseEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.button === 1) {
      window.open(`/ecritures/${id}`, '_blank');
      return;
    }
    if (detail?.ecriture.id === id) {
      // Déjà ouverte → replier (retirer ?detail).
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete('detail');
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return;
    }
    router.push(detailHref(id), { scroll: false });
  };
```

(`searchParams` et `pathname` sont déjà disponibles dans le composant.)

- [ ] **Step 3 : Rendre le panneau sous la ligne ouverte**

Dans le rendu d'une ligne d'écriture, on a déjà (étape 3) un `<Fragment key={item.key}>` contenant la `<TableRow>` + une éventuelle ligne-bannière. Calculer, à côté de `match`, si la ligne est ouverte :

```tsx
            const isOpen = detail?.ecriture.id === e.id;
```

Et, à l'intérieur du `<Fragment>`, APRÈS la `<TableRow>` de la ligne et la ligne-bannière conditionnelle, ajouter le panneau :

```tsx
                {isOpen && detail && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0 pb-2">
                      <EcritureInlinePanel
                        ecriture={detail.ecriture}
                        justifsBundle={detail.justifsBundle}
                        pendingDepots={detail.pendingDepots}
                        categories={categories}
                        topCategoryIds={topCategoryIds}
                        unites={unites}
                        modesPaiement={modesPaiement}
                        activites={activites}
                        cartes={cartes}
                      />
                    </TableCell>
                  </TableRow>
                )}
```

Optionnel (lisibilité) : ajouter une mise en évidence de la ligne ouverte — dans le `className` de la `<TableRow>` de la ligne, intégrer `${isOpen ? 'bg-muted/40' : ''}`.

- [ ] **Step 4 : Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/ecritures-table.tsx`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecritures-table.tsx
git commit -m "feat(ecritures): panneau d'édition inline sous la ligne (remplace le drawer)"
```

---

### Task 5 : Supprimer le drawer + vérifier

**Files:**
- Delete: `web/src/components/ecritures/ecriture-drawer.tsx`

- [ ] **Step 1 : Confirmer qu'aucun import ne subsiste**

Run: `cd web && grep -rn "EcritureDrawer\|ecriture-drawer" src/`
Expected: aucune occurrence (hors le fichier lui-même).

- [ ] **Step 2 : Supprimer le fichier**

```bash
cd "$(git rev-parse --show-toplevel)"
git rm web/src/components/ecritures/ecriture-drawer.tsx
```

- [ ] **Step 3 : Suite complète + typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run`
Expected: tsc sans erreur ; tests PASS (non-régression).

- [ ] **Step 4 : Contrôle visuel**

Lancer l'app, `/ecritures` :
- Clic sur une ligne → le panneau d'édition se déplie **sous la ligne** (origine bancaire, bandeau de complétude, formulaire, justificatifs, cycle de vie). Pas de drawer slide-over.
- Re-clic sur la même ligne (ou bouton ✕) → repli.
- Clic sur une autre ligne → l'ancien panneau se replie, le nouveau s'ouvre.
- Édition d'un champ + « Enregistrer les changements » → sauvegarde OK, le panneau reste ouvert.
- Boutons cycle de vie (Valider / Sync / etc.) fonctionnent comme avant.
- « Page complète » ouvre toujours `/ecritures/[id]`.
- Pas de scroll horizontal ; rendu correct dans les deux sections (À traiter / Bouclées).

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git commit -m "chore(ecritures): supprime EcritureDrawer (remplacé par le panneau inline)"
```

---

## Self-review (auteur du plan)

- **Couverture (4a)** : accordéon inline (Tasks 1,3,4) ✓ ; drawer supprimé (Tasks 2,5) ✓ ; page détail conservée (liens « Page complète ») ✓ ; chargement serveur `?detail` réutilisé (Task 2) ✓.
- **Placeholders** : le corps du panneau est porté verbatim depuis le drawer (Task 1) — l'implémenteur lit le fichier source ; le wrapper + en-tête + threading sont donnés en code complet.
- **Cohérence des noms** : bundle `detail = { ecriture, justifsBundle, pendingDepots }` identique page → infinite-list → table → `EcritureInlinePanel` ; `topCategoryIds` threadé idem.
- **Risque** : chemin critique d'édition. Mitigations : aucune logique d'édition réécrite (corps verbatim), page `/ecritures/[id]` comme filet, suite vitest + contrôle visuel obligatoire (Task 5).

## Suite

- Étape 4b : lignes aérées (style Dougs) + CTA de cycle de vie sur la ligne, désactivé tant que `computeReadiness` = incomplete.
