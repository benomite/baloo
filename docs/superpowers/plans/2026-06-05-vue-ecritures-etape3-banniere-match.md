# Vue Écritures — Étape 3 : bannière de correspondance + « Lier » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sous chaque écriture sans justif, afficher une bannière colorée quand un dépôt à traiter ou un remboursement actif « semble correspondre » (montant ±10 %, date ±15 j), avec un bouton « Lier » en un clic.

**Architecture:** Une fonction **pure** `suggestMatchForEcriture` (écriture + pools dépôts/remboursements → meilleur match) testée en TDD. La page charge **une fois** les pools (dépôts `a_traiter` + remboursements actifs, petits) et les passe au tableau client, qui matche **en mémoire** par ligne — pas de plomberie de pagination. Le « Lier » réutilise les server actions existantes (`attachDepotFromEcriture`) + une nouvelle (`lierRemboursementDepuisEcriture`).

**Tech Stack:** Next 16 (RSC + server actions), libsql/Turso, Tailwind, vitest.

**Référence spec:** `docs/superpowers/specs/2026-06-04-vue-ecritures-redesign-design.md`

---

## Structure des fichiers

| Fichier | Rôle | Action |
|---|---|---|
| `web/src/lib/services/ecriture-match.ts` | Fonction pure de matching + types | Créer |
| `web/src/lib/services/ecriture-match.test.ts` | Tests TDD | Créer |
| `web/src/lib/actions/depots.ts` | Server action liaison remb→écriture | Modifier : `lierRemboursementDepuisEcriture` |
| `web/src/components/ecritures/ecriture-match-banner.tsx` | Bannière + formulaires « Lier » | Créer |
| `web/src/components/ecritures/ecritures-table.tsx` | Rendu de la bannière par ligne | Modifier |
| `web/src/components/ecritures/ecritures-infinite-list.tsx` | Transmet les pools | Modifier |
| `web/src/app/(app)/ecritures/page.tsx` | Charge les pools (admin only) | Modifier |

**Réalité des tests :** TDD réel sur `suggestMatchForEcriture` (pure). Le reste (actions DB, UI) vérifié par `tsc` + `eslint` + visuel, conforme au codebase. Commandes vitest/tsc/eslint à lancer **depuis `web/`** avec le binaire local (`cd web && ./node_modules/.bin/vitest run …`).

**Garde-fou rôle :** les actions de liaison sont réservées aux admins (`tresorier`/`RG`). La page ne charge les pools (donc n'affiche les bannières) que pour ces rôles.

---

### Task 1 : Fonction pure `suggestMatchForEcriture` (TDD)

**Files:**
- Create: `web/src/lib/services/ecriture-match.ts`
- Create: `web/src/lib/services/ecriture-match.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `web/src/lib/services/ecriture-match.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { suggestMatchForEcriture } from './ecriture-match';

const depot = (over = {}) => ({ id: 'DEP1', amount_cents: 5000, date_estimee: '2026-01-10', titre: 'Courses', ...over });
const remb = (over = {}) => ({ id: 'RBT1', total_cents: 5000, date_depense: '2026-01-10', demandeur: 'Alice', ...over });
const ecr = { amount_cents: 5000, date_ecriture: '2026-01-10' };

describe('suggestMatchForEcriture', () => {
  it('match dépôt exact (montant + date)', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [])).toEqual({ kind: 'depot', id: 'DEP1', label: 'Courses' });
  });
  it('match dans la tolérance ±10% montant / ±15j date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: 5400, date_estimee: '2026-01-22' })], [])).not.toBeNull();
  });
  it('rejet hors tolérance montant', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: 6000 })], [])).toBeNull();
  });
  it('rejet hors tolérance date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ date_estimee: '2026-02-15' })], [])).toBeNull();
  });
  it('tolérance plancher 1€ pour petits montants', () => {
    // 50c d'écart sur 200c : 10% = 20c (plancher 100c) → 50c <= 100c → match
    expect(suggestMatchForEcriture(
      { amount_cents: 200, date_ecriture: '2026-01-10' },
      [depot({ amount_cents: 250 })], [],
    )).not.toBeNull();
  });
  it('ignore dépôt sans montant ou sans date', () => {
    expect(suggestMatchForEcriture(ecr, [depot({ amount_cents: null }), depot({ date_estimee: null })], [])).toBeNull();
  });
  it('match remboursement', () => {
    expect(suggestMatchForEcriture(ecr, [], [remb()])).toEqual({ kind: 'remboursement', id: 'RBT1', label: 'Alice' });
  });
  it('à égalité de date, préfère le dépôt', () => {
    expect(suggestMatchForEcriture(ecr, [depot()], [remb()])?.kind).toBe('depot');
  });
  it('choisit le plus proche en date', () => {
    const loin = depot({ id: 'DEP_LOIN', date_estimee: '2026-01-20' });
    const proche = depot({ id: 'DEP_PROCHE', date_estimee: '2026-01-11' });
    expect(suggestMatchForEcriture(ecr, [loin, proche], [])?.id).toBe('DEP_PROCHE');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/ecriture-match.test.ts`
Expected: FAIL (module / fonction introuvable).

- [ ] **Step 3 : Implémenter**

Créer `web/src/lib/services/ecriture-match.ts` :

```ts
// Matching « cette écriture sans justif ↔ un dépôt à traiter / un remboursement
// actif ». Pur (pas de DB) : la page charge les pools une fois, le tableau
// matche en mémoire par ligne. Tolérance alignée sur le matching dépôts
// existant (depots.ts) : montant ±10% (plancher 1€), date ±15 jours.

export interface MatchDepot {
  id: string;
  amount_cents: number | null;
  date_estimee: string | null;
  titre: string;
}
export interface MatchRemboursement {
  id: string;
  total_cents: number;
  date_depense: string | null;
  demandeur: string;
}
export type EcritureMatch =
  | { kind: 'depot'; id: string; label: string }
  | { kind: 'remboursement'; id: string; label: string };

const DATE_TOL_DAYS = 15;

function amountMatches(a: number, b: number): boolean {
  const tol = Math.max(100, Math.round(Math.abs(a) * 0.1));
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function suggestMatchForEcriture(
  ecriture: { amount_cents: number; date_ecriture: string },
  depots: MatchDepot[],
  rembs: MatchRemboursement[],
): EcritureMatch | null {
  let best: { match: EcritureMatch; dist: number; pref: number } | null = null;
  const consider = (match: EcritureMatch, dist: number, pref: number) => {
    if (!best || dist < best.dist || (dist === best.dist && pref < best.pref)) {
      best = { match, dist, pref };
    }
  };

  for (const d of depots) {
    if (d.amount_cents == null || d.date_estimee == null) continue;
    if (!amountMatches(ecriture.amount_cents, d.amount_cents)) continue;
    const dist = dayDiff(ecriture.date_ecriture, d.date_estimee);
    if (dist > DATE_TOL_DAYS) continue;
    consider({ kind: 'depot', id: d.id, label: d.titre }, dist, 0);
  }
  for (const r of rembs) {
    if (r.date_depense == null) continue;
    if (!amountMatches(ecriture.amount_cents, r.total_cents)) continue;
    const dist = dayDiff(ecriture.date_ecriture, r.date_depense);
    if (dist > DATE_TOL_DAYS) continue;
    consider({ kind: 'remboursement', id: r.id, label: r.demandeur }, dist, 1);
  }

  return best ? best.match : null;
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/ecriture-match.test.ts`
Expected: PASS (tous les cas).

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/ecriture-match.ts web/src/lib/services/ecriture-match.test.ts
git commit -m "feat(ecritures): suggestMatchForEcriture — matching pur écriture↔dépôt/remb"
```

---

### Task 2 : Server action `lierRemboursementDepuisEcriture`

**Files:**
- Modify: `web/src/lib/actions/depots.ts`

- [ ] **Step 1 : Vérifier l'import du service de lien**

Ouvrir `web/src/lib/actions/depots.ts`. En haut, vérifier les imports existants. Ajouter (s'il n'y est pas déjà) :

```ts
import { setRembsEcritureLink } from '@/lib/services/remboursement-ecriture-link';
```

(`setRembsEcritureLink(groupId, remboursementId, ecritureId)` renvoie `{ ok: boolean; error?: string }` — c'est le service utilisé par `lierEcritureRemboursement` dans `actions/inbox.ts`.)

- [ ] **Step 2 : Ajouter l'action**

À la fin de `web/src/lib/actions/depots.ts`, ajouter (miroir de `attachDepotFromEcriture` mais pour un remboursement, redirection propre vers la page détail de l'écriture) :

```ts
// Lie un remboursement actif à une écriture depuis la vue Écritures
// (bannière de correspondance). L'écriture compte alors comme justifiée
// (la feuille de remboursement fait office de justif). Admin only.
export async function lierRemboursementDepuisEcriture(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect('/ecritures?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const ecritureId = formData.get('ecriture_id') as string | null;
  const remboursementId = formData.get('remboursement_id') as string | null;
  if (!ecritureId || !remboursementId) {
    redirect('/ecritures?error=' + encodeURIComponent('Écriture et remboursement requis.'));
  }
  const result = await setRembsEcritureLink(ctx.groupId, remboursementId!, ecritureId!);
  if (!result.ok) {
    redirect(`/ecritures/${ecritureId}?error=` + encodeURIComponent(result.error ?? 'Liaison refusée.'));
  }
  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${remboursementId}`);
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect(`/ecritures/${ecritureId}`);
}
```

> `getCurrentContext`, `isAdminRole`, `redirect`, `revalidatePath` sont déjà importés dans ce fichier (utilisés par les actions existantes). Ne pas les ré-importer.

- [ ] **Step 3 : Typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/actions/depots.ts
git commit -m "feat(ecritures): action lierRemboursementDepuisEcriture (bannière)"
```

---

### Task 3 : Composant `EcritureMatchBanner`

**Files:**
- Create: `web/src/components/ecritures/ecriture-match-banner.tsx`

- [ ] **Step 1 : Créer le composant**

Créer `web/src/components/ecritures/ecriture-match-banner.tsx` :

```tsx
import { Link2 } from 'lucide-react';
import { PendingButton } from '@/components/shared/pending-button';
import { attachDepotFromEcriture, lierRemboursementDepuisEcriture } from '@/lib/actions/depots';
import type { EcritureMatch } from '@/lib/services/ecriture-match';

// Bannière « un dépôt / remboursement semble correspondre · Lier » affichée
// sous une écriture sans justif. Un seul bouton (form server action). Admin
// only (la page ne fournit les pools qu'aux admins).
export function EcritureMatchBanner({
  match,
  ecritureId,
}: {
  match: EcritureMatch;
  ecritureId: string;
}) {
  if (match.kind === 'depot') {
    return (
      <Banner
        text={
          <>
            Un dépôt <b className="font-medium">« {match.label} »</b> semble correspondre
          </>
        }
      >
        <form action={attachDepotFromEcriture}>
          <input type="hidden" name="depot_id" value={match.id} />
          <input type="hidden" name="ecriture_id" value={ecritureId} />
          <PendingButton size="xs">Lier</PendingButton>
        </form>
      </Banner>
    );
  }
  return (
    <Banner
      text={
        <>
          Un remboursement de <b className="font-medium">{match.label}</b> semble correspondre
        </>
      }
    >
      <form action={lierRemboursementDepuisEcriture}>
        <input type="hidden" name="remboursement_id" value={match.id} />
        <input type="hidden" name="ecriture_id" value={ecritureId} />
        <PendingButton size="xs">Lier</PendingButton>
      </form>
    </Banner>
  );
}

function Banner({ text, children }: { text: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/25 px-2.5 py-1.5 text-[12px] text-amber-900 dark:text-amber-200">
      <Link2 size={13} strokeWidth={2} className="shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
      <div className="ml-auto shrink-0">{children}</div>
    </div>
  );
}
```

> Le `<form action={serverAction}>` dans un composant rendu sous un client component est le pattern Next standard ; pas besoin de `'use client'` ici (pas de hook).

- [ ] **Step 2 : Vérifier `size="xs"` sur PendingButton**

Run: `cd web && grep -n "size" src/components/shared/pending-button.tsx | head`
Si `PendingButton` ne propage pas `size` au `Button` (ou si `xs` n'existe pas), remplacer `size="xs"` par `size="sm"` dans le composant ci-dessus. (Le `Button` du codebase a bien une variante `xs` — cf. button.tsx.)

- [ ] **Step 3 : Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/components/ecritures/ecriture-match-banner.tsx`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/components/ecritures/ecriture-match-banner.tsx
git commit -m "feat(ecritures): EcritureMatchBanner — bannière de correspondance + Lier"
```

---

### Task 4 : Charger les pools (page) et les transmettre jusqu'au tableau

**Files:**
- Modify: `web/src/app/(app)/ecritures/page.tsx`
- Modify: `web/src/components/ecritures/ecritures-infinite-list.tsx`
- Modify: `web/src/components/ecritures/ecritures-table.tsx`

- [ ] **Step 1 : page.tsx — charger les pools (admin only) et les mapper**

Dans `web/src/app/(app)/ecritures/page.tsx` :

Ajouter les imports :

```tsx
import { listDepots, listAllAttachableRemboursements } from '@/lib/services/depots';
import type { MatchDepot, MatchRemboursement } from '@/lib/services/ecriture-match';
```

Après `requireNotParent(ctx.role);`, calculer le flag admin :

```tsx
  const canLink = ctx.role === 'tresorier' || ctx.role === 'RG';
```

Charger les pools (seulement si admin — sinon listes vides). Ajouter ces deux appels À LA FIN du tableau du `Promise.all([...])` :

```tsx
    canLink ? listDepots({ groupId: ctx.groupId }, { statut: 'a_traiter' }) : Promise.resolve([]),
    canLink ? listAllAttachableRemboursements({ groupId: ctx.groupId }) : Promise.resolve([]),
```

et les variables correspondantes À LA FIN de la destructuration (après `headerTotals,`) :

```tsx
    rawMatchDepots,
    rawMatchRembs,
```

Après le `Promise.all`, mapper vers les pools légers :

```tsx
  const matchDepots: MatchDepot[] = rawMatchDepots.map((d) => ({
    id: d.id,
    amount_cents: d.amount_cents,
    date_estimee: d.date_estimee,
    titre: d.titre,
  }));
  const matchRembs: MatchRemboursement[] = rawMatchRembs.map((r) => ({
    id: r.id,
    total_cents: r.total_cents,
    date_depense: r.date_depense,
    demandeur: r.demandeur,
  }));
```

Passer ces deux props aux DEUX `<EcrituresInfiniteList>` (sections « À traiter » et « Bouclées »), en plus des props existantes :

```tsx
          matchDepots={matchDepots}
          matchRembs={matchRembs}
```

- [ ] **Step 2 : ecritures-infinite-list.tsx — transmettre les pools**

Dans `web/src/components/ecritures/ecritures-infinite-list.tsx` :

Ajouter l'import de types :

```tsx
import type { MatchDepot, MatchRemboursement } from '@/lib/services/ecriture-match';
```

Ajouter au `interface Props` :

```tsx
  matchDepots: MatchDepot[];
  matchRembs: MatchRemboursement[];
```

Les déstructurer dans la signature du composant (avec les autres props) et les passer à `<EcrituresTable ... />` :

```tsx
        matchDepots={matchDepots}
        matchRembs={matchRembs}
```

- [ ] **Step 3 : ecritures-table.tsx — props + rendu de la bannière**

Dans `web/src/components/ecritures/ecritures-table.tsx` :

a) Imports :

```tsx
import { Fragment } from 'react';
import { suggestMatchForEcriture, type MatchDepot, type MatchRemboursement } from '@/lib/services/ecriture-match';
import { EcritureMatchBanner } from './ecriture-match-banner';
```

b) Ajouter à `interface Props` :

```tsx
  matchDepots: MatchDepot[];
  matchRembs: MatchRemboursement[];
```

c) Les déstructurer dans la signature : `export function EcrituresTable({ ecritures, categories, unites, modesPaiement, activites, cartes, matchDepots, matchRembs }: Props) {`

d) Dans le rendu d'une ligne d'écriture, repérer le `return ( <TableRow ...> ... </TableRow> );` final (la ligne, pas l'en-tête de groupe). Juste avant ce `return`, calculer le match :

```tsx
            const match =
              !e.has_justificatif && !e.remboursement_id && (matchDepots.length > 0 || matchRembs.length > 0)
                ? suggestMatchForEcriture(
                    { amount_cents: e.amount_cents, date_ecriture: e.date_ecriture },
                    matchDepots,
                    matchRembs,
                  )
                : null;
```

e) Remplacer le `return ( <TableRow key={item.key} ...> ... </TableRow> );` de la ligne par un Fragment qui ajoute la bannière sous la ligne. Concrètement, envelopper : retirer `key={item.key}` du `<TableRow>` et le mettre sur le `<Fragment>` :

```tsx
            return (
              <Fragment key={item.key}>
                <TableRow
                  className={`${rowBg} cursor-pointer hover:bg-muted/30 transition-colors`}
                  onClick={onRowClick(e.id)}
                >
                  {/* … les 6 TableCell existants, inchangés … */}
                </TableRow>
                {match && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-1.5">
                      <EcritureMatchBanner match={match} ecritureId={e.id} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
```

> Ne change RIEN au contenu des 6 `<TableCell>` de la ligne ; on ne fait qu'envelopper dans un `Fragment` et ajouter la ligne-bannière conditionnelle. Le `colSpan={6}` correspond aux 6 colonnes (cf. étape 1).

- [ ] **Step 4 : Typecheck + lint**

Run: `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint "src/app/(app)/ecritures/page.tsx" src/components/ecritures/ecritures-infinite-list.tsx src/components/ecritures/ecritures-table.tsx`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add "web/src/app/(app)/ecritures/page.tsx" web/src/components/ecritures/ecritures-infinite-list.tsx web/src/components/ecritures/ecritures-table.tsx
git commit -m "feat(ecritures): affiche la bannière de correspondance sous les écritures sans justif"
```

---

### Task 5 : Vérification

**Files:** aucun.

- [ ] **Step 1 : Suite complète**

Run: `cd web && ./node_modules/.bin/vitest run`
Expected: PASS (dont les nouveaux tests `ecriture-match`).

- [ ] **Step 2 : Contrôle visuel**

Lancer l'app, ouvrir `/ecritures` en tant que trésorier. Vérifier :
- Une écriture sans justif dont le montant/date matche un dépôt à traiter affiche la bannière ambre « Un dépôt … semble correspondre · Lier ».
- Cliquer « Lier » → l'écriture est rattachée (redirection vers `/ecritures/{id}`, justif présent), la bannière disparaît au retour sur la liste.
- Idem pour un remboursement actif qui matche.
- Aucune bannière sur les écritures qui ont déjà un justif ou un remboursement lié.
- En tant que `chef` (non admin), aucune bannière (pools non chargés).
- Pas de scroll horizontal introduit ; les bannières s'affichent bien sous la ligne concernée, dans les deux sections.

---

## Self-review (auteur du plan)

- **Couverture spec (étape 3)** : bannière dépôt + remboursement (Tasks 1,3,4) ✓ ; matching ±10 %/±15 j réutilisé (Task 1) ✓ ; « Lier » en un clic (Tasks 2,3) ✓ ; calcul borné via pools chargés une fois (Task 4) ✓ ; admin only (Task 4) ✓.
- **Placeholders** : aucun ; code complet à chaque step.
- **Cohérence des noms** : `MatchDepot`/`MatchRemboursement`/`EcritureMatch`/`suggestMatchForEcriture` (Task 1) réutilisés identiquement Tasks 3-4 ; props `matchDepots`/`matchRembs` cohérentes page → infinite-list → table ; action `lierRemboursementDepuisEcriture` (Task 2) appelée dans le composant (Task 3).
- **Tests** : TDD réel sur la fonction pure ; UI/actions vérifiées par tsc/eslint/visuel.

## Suite

- Étape 4 : lignes aérées + accordéon inline + suppression du drawer + gate `computeReadiness`.
