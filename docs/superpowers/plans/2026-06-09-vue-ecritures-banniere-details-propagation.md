# Vue Écritures — Bannière de correspondance : détails dépliables + Lier sans navigation + propagation imputation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Améliorer la bannière de correspondance (étape 3) : (1) **dépliable** au clic pour vérifier le match (montant · date · unité · catégorie/statut) ; (2) le bouton **« Lier » ne fait plus sortir de la vue** (action côté client, toast + refresh en place) ; (3) la liaison **recopie sur l'écriture les imputations manquantes** (unité, activité, catégorie) depuis le remboursement/dépôt.

**Architecture:** Le match porte désormais les champs d'affichage (flat `EcritureMatch`). La bannière devient un composant client dépliable qui appelle des **server actions non-redirigeantes** (`linkDepotToEcriture` / `linkRembToEcriture` renvoyant `{ ok, error }`) puis `router.refresh()`. La propagation côté **remboursement** est ajoutée à `setRembsEcritureLink` (côté **dépôt** elle existe déjà dans `attachDepotToEcriture`). Règle stricte : COALESCE (jamais d'écrasement), drafts uniquement.

**Tech Stack:** Next 16, libsql, Tailwind, vitest. Commandes depuis `web/` avec le binaire local.

**Contexte data (vérifié) :**
- Remboursement : `unite_id`, `activite_id`, `category_id`, `demandeur`, `total_cents`, `date_depense`, `status` (+ `unite_code` via join).
- Dépôt : `unite_id`, `category_id`, `carte_id` (PAS d'`activite_id`), `titre`, `amount_cents`, `date_estimee` (+ `unite_code`, `category_name` via join).
- `attachDepotToEcriture` propage déjà category+unité+carte (drafts, COALESCE). `setRembsEcritureLink` ne propage rien → à compléter.

---

## Structure des fichiers

| Fichier | Action |
|---|---|
| `web/src/lib/services/ecriture-match.ts` (+ `.test.ts`) | Enrichir `EcritureMatch` (champs d'affichage) |
| `web/src/app/(app)/ecritures/page.tsx` | Peupler les champs enrichis des pools |
| `web/src/lib/services/remboursement-ecriture-link.ts` | Propager unité/activité/catégorie (remb → écriture) |
| `web/src/lib/actions/depots.ts` | Actions client non-redirigeantes `linkDepotToEcriture` / `linkRembToEcriture` |
| `web/src/components/ecritures/ecriture-match-banner.tsx` | Réécriture : dépliable + Lier client |

---

### Task 1 : Enrichir `EcritureMatch` (champs d'affichage)

**Files:** Modify `web/src/lib/services/ecriture-match.ts` + `web/src/lib/services/ecriture-match.test.ts`

- [ ] **Step 1 : Mettre à jour les tests**

Dans `ecriture-match.test.ts`, les fixtures et assertions doivent refléter le nouveau match plat. Remplacer le contenu du fichier par :

```ts
import { describe, it, expect } from 'vitest';
import { suggestMatchForEcriture } from './ecriture-match';

const depot = (over = {}) => ({ id: 'DEP1', amount_cents: 5000, date_estimee: '2026-01-10', titre: 'Courses', uniteCode: 'PC', categoryName: 'Intendance', ...over });
const remb = (over = {}) => ({ id: 'RBT1', total_cents: 5000, date_depense: '2026-01-10', demandeur: 'Alice', uniteCode: 'LJ', status: 'virement_effectue', ...over });
const ecr = { amount_cents: 5000, date_ecriture: '2026-01-10' };

describe('suggestMatchForEcriture', () => {
  it('match dépôt exact → champs d\'affichage', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [])).toEqual({
      kind: 'depot', id: 'DEP1', label: 'Courses', amountCents: 5000, date: '2026-01-10', uniteCode: 'PC', detail: 'Intendance',
    });
  });
  it('match remboursement → champs d\'affichage', () => {
    expect(suggestMatchForEcriture(ecr, [], [remb()])).toEqual({
      kind: 'remboursement', id: 'RBT1', label: 'Alice', amountCents: 5000, date: '2026-01-10', uniteCode: 'LJ', detail: 'virement_effectue',
    });
  });
  it('tolérance ±10% / ±15j', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: 5400, date_estimee: '2026-01-22' })], [])).not.toBeNull();
  });
  it('rejet hors tolérance montant', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: 6000 })], [])).toBeNull();
  });
  it('rejet hors tolérance date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ date_estimee: '2026-02-15' })], [])).toBeNull();
  });
  it('plancher 1€', () => {
    expect(suggestMatchForEcriture({ amount_cents: 200, date_ecriture: '2026-01-10' }, [depot({ amount_cents: 250 })], [])).not.toBeNull();
  });
  it('ignore dépôt sans montant ou sans date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: null }), depot({ date_estimee: null })], [])).toBeNull();
  });
  it('à égalité de date, préfère le dépôt', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [remb()])?.kind).toBe('depot');
  });
  it('choisit le plus proche en date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ id: 'LOIN', date_estimee: '2026-01-20' }), depot({ id: 'PROCHE', date_estimee: '2026-01-11' })], [])?.id).toBe('PROCHE');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** — `cd web && ./node_modules/.bin/vitest run src/lib/services/ecriture-match.test.ts` (FAIL : champs manquants).

- [ ] **Step 3 : Mettre à jour `ecriture-match.ts`**

Enrichir les types de pool + le type de retour + la construction. Remplacer les interfaces de pool et `EcritureMatch`, et adapter les deux `candidates.push(...)` :

```ts
export interface MatchDepot {
  id: string;
  amount_cents: number | null;
  date_estimee: string | null;
  titre: string;
  uniteCode: string | null;
  categoryName: string | null;
}
export interface MatchRemboursement {
  id: string;
  total_cents: number;
  date_depense: string | null;
  demandeur: string;
  uniteCode: string | null;
  status: string;
}
export interface EcritureMatch {
  kind: 'depot' | 'remboursement';
  id: string;
  label: string;            // titre (dépôt) / demandeur (remb)
  amountCents: number | null;
  date: string | null;
  uniteCode: string | null;
  detail: string | null;    // catégorie (dépôt) / statut (remb)
}
```

Dans `suggestMatchForEcriture`, les `push` deviennent :

```ts
    candidates.push({
      match: { kind: 'depot', id: d.id, label: d.titre, amountCents: d.amount_cents, date: d.date_estimee, uniteCode: d.uniteCode, detail: d.categoryName },
      dist, pref: 0,
    });
```
et
```ts
    candidates.push({
      match: { kind: 'remboursement', id: r.id, label: r.demandeur, amountCents: r.total_cents, date: r.date_depense, uniteCode: r.uniteCode, detail: r.status },
      dist, pref: 1,
    });
```
(Le reste de la fonction — tolérance, tri, `candidates[0].match` — est inchangé. Le type interne `candidates` est `{ match: EcritureMatch; dist: number; pref: number }[]`.)

- [ ] **Step 4 : Lancer, vérifier le succès** — `cd web && ./node_modules/.bin/vitest run src/lib/services/ecriture-match.test.ts` (PASS). Puis `./node_modules/.bin/tsc --noEmit -p tsconfig.json` → erreur ATTENDUE sur `page.tsx` (le mapping des pools ne fournit pas encore `uniteCode`/`categoryName`/`status`) ; corrigée Task 2. Aucune autre erreur.

- [ ] **Step 5 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/ecriture-match.ts web/src/lib/services/ecriture-match.test.ts
git commit -m "feat(ecritures): EcritureMatch porte les champs d'affichage (montant/date/unité/détail)"
```

---

### Task 2 : Peupler les champs enrichis dans la page

**Files:** Modify `web/src/app/(app)/ecritures/page.tsx`

- [ ] **Step 1 : Compléter le mapping des pools**

Repérer les `const matchDepots: MatchDepot[] = rawMatchDepots.map(...)` et `const matchRembs: MatchRemboursement[] = rawMatchRembs.map(...)`. Ajouter les champs :

```tsx
  const matchDepots: MatchDepot[] = rawMatchDepots.map((d) => ({
    id: d.id,
    amount_cents: d.amount_cents,
    date_estimee: d.date_estimee,
    titre: d.titre,
    uniteCode: d.unite_code ?? null,
    categoryName: d.category_name ?? null,
  }));
  const matchRembs: MatchRemboursement[] = rawMatchRembs.map((r) => ({
    id: r.id,
    total_cents: r.total_cents,
    date_depense: r.date_depense,
    demandeur: r.demandeur,
    uniteCode: r.unite_code ?? null,
    status: r.status,
  }));
```

> `rawMatchDepots` = `listDepots(...)` (DepotEnriched : `unite_code`, `category_name`). `rawMatchRembs` = `listAllAttachableRemboursements(...)` (CandidateRemboursement : `unite_code`, `status`). Si un champ joint a un autre nom, l'ajuster.

- [ ] **Step 2 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint "src/app/(app)/ecritures/page.tsx"` → 0 erreur (l'erreur de Task 1 disparaît).

- [ ] **Step 3 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add "web/src/app/(app)/ecritures/page.tsx"
git commit -m "feat(ecritures): peuple unité/détail des pools de correspondance"
```

---

### Task 3 : Propagation imputation côté remboursement

**Files:** Modify `web/src/lib/services/remboursement-ecriture-link.ts`

- [ ] **Step 1 : Ajouter la propagation dans `setRembsEcritureLink`**

Juste AVANT le `return { ok: true, previous: current.ecriture_id };` final, ajouter (recopie unité/activité/catégorie de la demande dans les champs vides d'une écriture en draft) :

```ts
  // Enrichissement : recopie l'imputation de la demande (unité / activité /
  // catégorie) dans les champs ENCORE VIDES de l'écriture liée. COALESCE →
  // jamais d'écrasement d'une valeur saisie. `status = 'draft'` → on ne
  // touche pas à une écriture déjà dans Comptaweb (mirror/divergent).
  if (ecritureId) {
    const remb = await db
      .prepare(
        `SELECT unite_id, activite_id, category_id
         FROM remboursements WHERE id = ? AND group_id = ?`,
      )
      .get<{ unite_id: string | null; activite_id: string | null; category_id: string | null }>(rembsId, groupId);
    if (remb) {
      await db
        .prepare(
          `UPDATE ecritures SET
             unite_id    = COALESCE(unite_id, ?),
             activite_id = COALESCE(activite_id, ?),
             category_id = COALESCE(category_id, ?),
             updated_at  = ?
           WHERE id = ? AND group_id = ? AND status = 'draft'`,
        )
        .run(remb.unite_id, remb.activite_id, remb.category_id, new Date().toISOString(), ecritureId, groupId);
    }
  }
```

- [ ] **Step 2 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/lib/services/remboursement-ecriture-link.ts` → 0 erreur. Puis non-régression : `./node_modules/.bin/vitest run 2>&1 | tail -3`.

- [ ] **Step 3 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/remboursement-ecriture-link.ts
git commit -m "feat(ecritures): lier un remb recopie unité/activité/catégorie sur l'écriture (drafts, COALESCE)"
```

---

### Task 4 : Actions client non-redirigeantes

**Files:** Modify `web/src/lib/actions/depots.ts`

- [ ] **Step 1 : Ajouter deux actions renvoyant `{ ok, error }`**

À la fin de `web/src/lib/actions/depots.ts`, ajouter (ne PAS rediriger : c'est appelé depuis un bouton client qui fera `router.refresh()`) :

```ts
// Variantes « en place » de la liaison depuis la bannière de correspondance :
// renvoient un résultat au lieu de rediriger, pour rester dans la vue liste.
export async function linkDepotToEcriture(
  depotId: string,
  ecritureId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
  try {
    await attachDepotToEcritureService({ groupId: ctx.groupId }, depotId, ecritureId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath('/ecritures');
  revalidatePath('/depots');
  return { ok: true };
}

export async function linkRembToEcriture(
  remboursementId: string,
  ecritureId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) return { ok: false, error: 'Action réservée aux trésoriers / RG.' };
  const result = await setRembsEcritureLink(ctx.groupId, remboursementId, ecritureId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/ecritures');
  revalidatePath('/remboursements');
  return { ok: true };
}
```

> `attachDepotToEcritureService` est l'alias d'import déjà utilisé par `attachDepotFromEcriture` dans ce fichier (vérifier le nom exact de l'import en haut ; sinon utiliser le nom réellement importé du service `attachDepotToEcriture`). `setRembsEcritureLink`, `getCurrentContext`, `isAdminRole`, `revalidatePath` sont déjà importés (Task précédente + actions existantes).

- [ ] **Step 2 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/lib/actions/depots.ts` → 0 erreur.

- [ ] **Step 3 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/actions/depots.ts
git commit -m "feat(ecritures): actions linkDepot/RembToEcriture (en place, sans redirection)"
```

---

### Task 5 : Réécrire `EcritureMatchBanner` (dépliable + Lier client)

**Files:** Modify `web/src/components/ecritures/ecriture-match-banner.tsx`

- [ ] **Step 1 : Remplacer le contenu du fichier**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/shared/amount';
import { linkDepotToEcriture, linkRembToEcriture } from '@/lib/actions/depots';
import type { EcritureMatch } from '@/lib/services/ecriture-match';

// Bannière « un dépôt / remboursement semble correspondre ». Dépliable
// (clic → détails pour vérifier le match) et « Lier » en place (toast +
// refresh, aucune navigation). Admin only (pools fournis aux admins).
export function EcritureMatchBanner({
  match,
  ecritureId,
}: {
  match: EcritureMatch;
  ecritureId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const isDepot = match.kind === 'depot';

  const lier = () =>
    startTransition(async () => {
      const res = isDepot
        ? await linkDepotToEcriture(match.id, ecritureId)
        : await linkRembToEcriture(match.id, ecritureId);
      if (res.ok) {
        toast.success('Rattaché à l’écriture.');
        router.refresh();
      } else {
        toast.error(res.error ?? 'Liaison impossible.');
      }
    });

  return (
    <div className="rounded-md bg-amber-50 dark:bg-amber-950/25 text-amber-900 dark:text-amber-200">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
        <Link2 size={13} strokeWidth={2} className="shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 flex items-center gap-1 text-left hover:underline"
          aria-expanded={open}
        >
          <span className="truncate">
            {isDepot ? (
              <>Un dépôt <b className="font-medium">« {match.label} »</b> semble correspondre</>
            ) : (
              <>Un remboursement de <b className="font-medium">{match.label}</b> semble correspondre</>
            )}
          </span>
          <ChevronDown size={12} strokeWidth={2.25} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <div className="ml-auto shrink-0">
          <Button size="xs" disabled={pending} onClick={lier}>Lier</Button>
        </div>
      </div>
      {open && (
        <dl className="mx-2.5 mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-amber-200/60 dark:border-amber-900/40 pt-1.5 text-[11.5px]">
          <dt className="text-amber-700/80 dark:text-amber-300/70">Montant</dt>
          <dd className="tabular-nums font-medium">
            {match.amountCents != null ? <Amount cents={match.amountCents} /> : '—'}
          </dd>
          <dt className="text-amber-700/80 dark:text-amber-300/70">Date</dt>
          <dd className="tabular-nums">{match.date ?? '—'}</dd>
          <dt className="text-amber-700/80 dark:text-amber-300/70">Unité</dt>
          <dd>{match.uniteCode ?? '—'}</dd>
          <dt className="text-amber-700/80 dark:text-amber-300/70">{isDepot ? 'Catégorie' : 'Statut'}</dt>
          <dd>{match.detail ?? '—'}</dd>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/ecriture-match-banner.tsx` → 0 erreur.

> La bannière est rendue (étape 4b) dans un `<div>` SŒUR de la carte cliquable (pas à l'intérieur du `onClick` de la ligne) → ses boutons ne déclenchent pas l'accordéon, pas besoin de `stopPropagation`.

- [ ] **Step 3 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecriture-match-banner.tsx
git commit -m "feat(ecritures): bannière dépliable (détails du match) + Lier en place (sans navigation)"
```

---

### Task 6 : Vérification

- [ ] **Step 1 : Suite + tsc** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vitest run` → tsc clean, tests PASS.

- [ ] **Step 2 : Contrôle visuel** `/ecritures` (trésorier) :
  - Clic sur la bannière → déplie montant · date · unité · catégorie(dépôt)/statut(remb).
  - « Lier » → toast, la liste se met à jour **sur place** (pas de navigation, scroll conservé), la bannière disparaît.
  - Après liaison d'un remboursement : l'écriture (draft) a récupéré **unité / activité / catégorie** du remb (vérifier dans le panneau ou les colonnes).
  - Un champ déjà renseigné sur l'écriture n'est PAS écrasé.
  - Rien pour un non-admin.

---

## Self-review (auteur du plan)

- **Couverture** : (1) bannière dépliable (Tasks 1,2,5) ; (2) Lier sans navigation (Tasks 4,5) ; (3) propagation unité/activité/catégorie remb (Task 3 ; dépôt déjà fait). ✓
- **Placeholders** : code complet ; 2 notes « vérifier le nom d'import » (champs joints, alias service).
- **Cohérence** : `EcritureMatch` plat (label/id/kind conservés → l'ancienne bannière compile jusqu'à sa réécriture Task 5) ; `MatchDepot/MatchRemboursement` enrichis cohérents page↔fn ; actions `linkDepot/RembToEcriture` ↔ bannière.
- **Règle données** : propagation COALESCE + drafts only (jamais d'écrasement, jamais de modif d'une écriture dans CW). Aucun DELETE.
