# Vue Écritures — Étape 4b : lignes aérées en cartes (style Dougs) + CTA « Valider » gaté — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remplacer le rendu `<table>` de la liste d'écritures par des **cartes aérées** (style Dougs), en **préservant toute la logique** (regroupement banque/CW, sélection multiple + batch edit, édition inline catégorie/unité, bannière de correspondance, accordéon inline). Ajouter un CTA unique **« Valider »** sur les cartes en `draft`, **désactivé tant que `computeReadiness` = incomplete** (un draft incomplet ne peut pas être créé dans Comptaweb).

**Architecture:** On réécrit le **markup** de `EcrituresTable` (de `<Table>/<TableRow>/<TableCell>` vers une liste de `<div>` cartes flex). **Aucune logique d'état n'est touchée** : `items` (header/row), `selected`/`toggleRow`/`toggleAll`, `collapsed`/`toggleGroup`, `onRowClick` (toggle accordéon), `match`/`isOpen`, les `InlineSelect` catégorie/unité, `BatchEditBar`, le panneau `EcritureInlinePanel` et la bannière `EcritureMatchBanner` restent identiques — seul leur conteneur visuel change. Le CTA « Valider » est un nouveau composant compact qui appelle l'action existante `syncDraftToComptaweb`.

**Tech Stack:** Next 16, Tailwind, vitest.

**Référence spec:** `docs/superpowers/specs/2026-06-04-vue-ecritures-redesign-design.md` (étape 4). Modèle CTA validé avec l'utilisateur le 2026-06-08 : un draft → « Valider » crée dans CW ; une fois dans CW, rien à faire (CW = source de vérité).

**Commandes :** depuis `web/` avec le binaire local — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`, `./node_modules/.bin/eslint <files>`, `./node_modules/.bin/vitest run`.

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `web/src/components/ecritures/valider-cw-button.tsx` | CTA « Valider » compact (crée dans CW, gaté) | Créer |
| `web/src/components/ecritures/ecritures-table.tsx` | Rendu cartes (markup réécrit, logique conservée) | Modifier (gros) |

**Réalité des tests :** pas de logique pure nouvelle → pas de TDD. Vérif `tsc` + `eslint` + suite `vitest` (non-régression) + **contrôle visuel approfondi** (composant central : sélection, groupes, accordéon). Le composant `Table` (ui) n'est plus utilisé par EcrituresTable après cette étape (laisser le fichier `ui/table.tsx`, réutilisable ailleurs).

---

### Task 1 : Composant `ValiderCwButton` (CTA gaté)

**Files:**
- Create: `web/src/components/ecritures/valider-cw-button.tsx`

- [ ] **Step 1 : Comprendre l'action existante**

Lire `web/src/components/ecritures/sync-draft-button.tsx` (utilise `syncDraftToComptaweb(ecritureId, { dryRun })` depuis `@/lib/actions/drafts`). Le « Valider » de la carte = la variante `dryRun: false` (crée dans CW, confirm obligatoire car irréversible).

- [ ] **Step 2 : Créer le composant**

Créer `web/src/components/ecritures/valider-cw-button.tsx` :

```tsx
'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncDraftToComptaweb } from '@/lib/actions/drafts';

// CTA compact « Valider » d'une carte écriture en draft : crée l'écriture
// dans Comptaweb (irréversible → confirm). `disabled` quand l'écriture est
// incomplète (gate `computeReadiness` côté appelant) ; `missing` liste les
// champs manquants pour le tooltip.
export function ValiderCwButton({
  ecritureId,
  disabled = false,
  missing = [],
}: {
  ecritureId: string;
  disabled?: boolean;
  missing?: string[];
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () =>
    startTransition(async () => {
      if (
        !window.confirm(
          'Créer cette écriture dans Comptaweb maintenant ? Action irréversible côté Comptaweb (suppression manuelle si erreur).',
        )
      )
        return;
      const res = await syncDraftToComptaweb(ecritureId, { dryRun: false });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });

  const title = disabled
    ? `À compléter avant de valider : ${missing.join(', ')}`
    : 'Créer cette écriture dans Comptaweb';

  return (
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
    >
      Valider
    </Button>
  );
}
```

- [ ] **Step 3 : Vérifier**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/valider-cw-button.tsx`
> Vérifier la signature réelle de `syncDraftToComptaweb` (retour `{ ok, message, ... }`) — si le champ message diffère, ajuster. Lire `src/lib/actions/drafts.ts` au besoin.
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/valider-cw-button.tsx
git commit -m "feat(ecritures): ValiderCwButton — CTA compact crée-dans-CW gaté"
```

---

### Task 2 : Réécrire le rendu de `EcrituresTable` en cartes

**Files:**
- Modify: `web/src/components/ecritures/ecritures-table.tsx`

**Principe : ne toucher qu'au JSX retourné (le `return (...)`).** Tout ce qui précède (hooks `useState`/`useMemo`, `items`, `toggleRow`/`toggleAll`/`clear`, `toggleGroup`, `groupEntries`/`selectGroup`, `onRowClick`, `isEditable`, `editableIds`, `detailHref`, `stop`, calcul de `match`/`isOpen`/`readiness`) **reste identique**. On remplace `<Table>…</Table>` par une liste de cartes, et `BatchEditBar` reste tel quel après.

- [ ] **Step 1 : Imports**

Ajouter :
```tsx
import { computeReadiness } from '@/lib/sync-readiness';
import { ValiderCwButton } from './valider-cw-button';
```
Retirer l'import de `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` (plus utilisés). Garder `Link`, `InlineSelect`, `UniteBadge`, `Amount`, `Landmark`, `Layers`, `EcritureMatchBanner`, `EcritureInlinePanel`, etc.

- [ ] **Step 2 : Remplacer le conteneur + l'en-tête de colonnes**

Le `return (<div><Table>…)` actuel a un `<TableHeader>` avec les colonnes + une case « tout sélectionner ». En cartes, pas de colonnes : on garde juste une **barre fine** avec la case tout-sélectionner + le compteur de sélection. Remplacer le début du rendu (de `<Table>` jusqu'à l'ouverture de `<TableBody>`) par :

```tsx
      <div className="rounded-xl border border-border-soft bg-bg-elevated overflow-hidden">
        {/* Barre fine : tout sélectionner (visible s'il y a des lignes éditables) */}
        {editableIds.length > 0 && (
          <div className="flex items-center gap-2 px-3 h-9 border-b border-border-soft bg-bg-sunken/40 text-[11.5px] text-fg-muted">
            <input
              type="checkbox"
              aria-label="Tout sélectionner"
              checked={allEditableSelected}
              onChange={toggleAll}
            />
            <span>Tout sélectionner</span>
          </div>
        )}
        <div className="divide-y divide-border-soft">
```

et la fin (de `</TableBody></Table>`) par :

```tsx
          {ecritures.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">Aucune écriture</div>
          )}
        </div>
      </div>
```

- [ ] **Step 3 : Carte d'en-tête de groupe (`item.kind === 'header'`)**

Remplacer le `return (<TableRow …>…</TableRow>)` du bloc header par une carte cliquable (toggle du groupe). Garder la logique (`g`, `gk`, `isCollapsed`, `style`, `editableInGroup`, `selectGroup`, `toggleGroup`) :

```tsx
              return (
                <div
                  key={item.key}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-xs text-muted-foreground ${style.headerBg}`}
                  onClick={() => toggleGroup(g)}
                  style={isCollapsed ? undefined : { boxShadow: `inset 3px 0 0 0 ${style.rail}` }}
                >
                  {editableInGroup.length > 0 ? (
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner le groupe ${gk}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => selectGroup(g)}
                      checked={editableInGroup.every((x) => selected.has(x.id))}
                    />
                  ) : (
                    <span className="w-[13px]" />
                  )}
                  <span className="text-xs">{isCollapsed ? '▶' : '▼'}</span>
                  {g.kind === 'bank' ? (
                    <Landmark size={13} className="text-muted-foreground" />
                  ) : (
                    <Layers size={13} className="text-indigo-500 dark:text-indigo-400" />
                  )}
                  <span className="font-medium">
                    {g.kind === 'bank' ? 'Ligne bancaire' : 'Écriture Comptaweb'}
                  </span>
                  <code className="text-[11px]">{g.sublabel}</code>
                  <span>·</span>
                  <span className="truncate max-w-md">{g.label}</span>
                  <span className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline">
                    {g.count} {g.kind === 'bank' ? 'sous-ligne' : 'ventilation'}{g.count > 1 ? 's' : ''}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums">
                    <Amount cents={g.totalCents} tone="signed" />
                  </span>
                </div>
              );
```

- [ ] **Step 4 : Carte de ligne d'écriture (`item.kind === 'row'`)**

Remplacer le `return (<Fragment key={item.key}><TableRow …>…6 cellules…</TableRow>{match && …}{isOpen && …}</Fragment>)` par une version cartes. **Conserver** les calculs déjà présents (`e`, `editable`, `isSelected`, `group`, `style`, `rowBg`, `railColor`, `railShadow`, `match`, `isOpen`). Ajouter, juste avant le `return`, le calcul de complétude pour le CTA :

```tsx
            const readiness = computeReadiness(e, { categories, unites, modesPaiement, activites });
            const showValider = e.status === 'draft';
```

Puis :

```tsx
            return (
              <div key={item.key}>
                <div
                  className={`group/row flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${rowBg} ${isOpen ? 'bg-muted/40' : 'hover:bg-muted/30'}`}
                  style={railShadow}
                  onClick={onRowClick(e.id)}
                >
                  {/* Sélection */}
                  <input
                    type="checkbox"
                    className="mt-1.5"
                    aria-label={`Sélectionner ${e.id}`}
                    checked={isSelected}
                    onClick={stop}
                    onChange={(ev) => toggleRow(item.index, (ev.nativeEvent as MouseEvent).shiftKey)}
                    disabled={!editable}
                    title={editable ? 'Shift+clic pour sélectionner une plage' : 'Écriture synchronisée Comptaweb — non modifiable'}
                  />

                  {/* Date jour + mois */}
                  <div className="shrink-0 w-10 text-center leading-none pt-0.5">
                    <div className="text-[15px] font-semibold tabular-nums text-fg">{e.date_ecriture.slice(8, 10)}</div>
                    <div className="text-[9.5px] uppercase tracking-wide text-fg-subtle">{moisCourt(e.date_ecriture)}</div>
                  </div>

                  {/* Corps : description + unité + bannière */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={detailHref(e.id)}
                      scroll={false}
                      onClick={stop}
                      className="block truncate font-medium text-[13.5px] text-fg hover:underline"
                      title={e.description}
                    >
                      {e.description}
                    </Link>
                    <div className="mt-1 flex items-center gap-2" onClick={stop}>
                      <InlineSelect
                        value={e.unite_id}
                        disabled={!editable}
                        placeholder="Aucune unité"
                        options={unites.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
                        display={<UniteBadge code={e.unite_code} name={e.unite_name} couleur={e.unite_couleur} />}
                        onSave={(v) => updateEcritureField(e.id, 'unite_id', v)}
                      />
                    </div>
                  </div>

                  {/* Catégorie inline */}
                  <div className="shrink-0 w-[150px] text-sm self-center" onClick={stop}>
                    <InlineSelect
                      value={e.category_id}
                      disabled={!editable}
                      placeholder="Aucune"
                      options={categories.map((c) => ({ value: c.id, label: c.name }))}
                      display={
                        e.category_name ? (
                          <span className="block truncate" title={e.category_name}>{e.category_name}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )
                      }
                      onSave={(v) => updateEcritureField(e.id, 'category_id', v)}
                    />
                  </div>

                  {/* Montant */}
                  <div className="shrink-0 w-[92px] text-right font-medium tabular-nums self-center">
                    <Amount cents={e.amount_cents} tone={e.type === 'depense' ? 'negative' : 'positive'} />
                  </div>

                  {/* CTA Valider (draft uniquement, gaté) */}
                  <div className="shrink-0 w-[88px] flex justify-end self-center" onClick={stop}>
                    {showValider && (
                      <ValiderCwButton
                        ecritureId={e.id}
                        disabled={readiness.level === 'incomplete'}
                        missing={readiness.missingFields}
                      />
                    )}
                  </div>
                </div>

                {/* Bannière de correspondance (étape 3) */}
                {match && (
                  <div className="px-3 pb-2 pl-16">
                    <EcritureMatchBanner match={match} ecritureId={e.id} />
                  </div>
                )}

                {/* Accordéon inline (étape 4a) */}
                {isOpen && detail && (
                  <div className="px-3 pb-2">
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
                  </div>
                )}
              </div>
            );
```

> `readiness.missingFields` et `readiness.level` : vérifier les noms exacts dans `src/lib/sync-readiness.ts` (`ReadinessReport`). Adapter si besoin.

- [ ] **Step 5 : Helper `moisCourt`**

Ajouter, près des autres helpers en haut du fichier (hors composant) :

```tsx
const MOIS_COURTS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
function moisCourt(dateIso: string): string {
  const m = parseInt(dateIso.slice(5, 7), 10);
  return MOIS_COURTS[m - 1] ?? '';
}
```

- [ ] **Step 6 : Vérifier typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/ecritures-table.tsx`
Expected: aucune erreur (ni import `Table*` orphelin).

- [ ] **Step 7 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecritures-table.tsx
git commit -m "feat(ecritures): liste en cartes aérées + CTA Valider gaté (style Dougs)"
```

---

### Task 3 : Vérification

**Files:** aucun.

- [ ] **Step 1 : Suite complète + typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run`
Expected: tsc clean ; tests PASS (non-régression).

- [ ] **Step 2 : Contrôle visuel approfondi** (composant central)

`/ecritures` :
- **Cartes aérées** dans les deux sections (À traiter ouverte, Bouclées repliée).
- **Rail couleur d'unité** à gauche, date jour+mois, description cliquable, dropdowns inline catégorie/unité, montant coloré.
- **CTA « Valider »** présent uniquement sur les cartes `draft` ; **désactivé** (grisé + tooltip des champs manquants) si catégorie/unité manquent ; actif sinon → confirm → crée dans CW.
- **Sélection multiple** : cases à cocher, shift+clic plage, « tout sélectionner », groupe ; `BatchEditBar` apparaît et fonctionne.
- **Regroupement** banque/CW : carte-entête repliable, sous-cartes nichées, total.
- **Bannière de correspondance** (sans justif) toujours affichée + « Lier ».
- **Accordéon** : clic carte → panneau déplié sous la carte ; re-clic → repli.
- Pas de scroll horizontal.

- [ ] **Step 3 : (commit d'ajustement visuel si nécessaire)**

```bash
cd "$(git rev-parse --show-toplevel)"
git commit -am "fix(ecritures): ajustements visuels cartes"  # si besoin
```

---

## Self-review (auteur du plan)

- **Couverture (4b)** : cartes aérées les deux sections (Task 2) ✓ ; CTA unique « Valider » sur drafts, gaté `computeReadiness` (Tasks 1,2) ✓ ; logique préservée (regroupement, sélection, inline-edit, bannière, accordéon — markup-only change) ✓.
- **Placeholders** : JSX des cartes fourni concrètement ; l'implémenteur lit le fichier source pour préserver les calculs amont. 2 points « vérifier la signature » explicitement notés (syncDraftToComptaweb, ReadinessReport).
- **Cohérence** : `match`/`isOpen`/`detail`/`topCategoryIds` réutilisés tels quels (étapes 3 & 4a) ; `ValiderCwButton` props alignées Task 1 ↔ Task 2.
- **Risque** : réécriture du rendu d'un composant central. Mitigation : logique d'état intacte (markup-only), `tsc`/`vitest`/contrôle visuel approfondi obligatoire, polish visuel itérable post-merge.

## Suite

Fin de la refonte (étapes 1 → 4b). Possibles itérations ultérieures : densité Bouclées, navigation clavier, vues sauvegardées (pistes 5/8 du brainstorm initial).
