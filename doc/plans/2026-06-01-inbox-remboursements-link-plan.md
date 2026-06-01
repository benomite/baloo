# Inbox — relier écritures de virement aux remboursements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de relier, depuis l'inbox, une écriture bancaire de virement à son remboursement (suggestions unifiées + 1 clic), et faire qu'une écriture liée à un remboursement compte comme justifiée partout.

**Architecture:** Matching pur étendu (`inbox-matching.ts`) avec `computeRembSuggestions` à côté de `computeAutoSuggestions`. Rejet « Pas ça » généralisé à une cible `depot|remboursement`. Lien logique : l'inbox et `/ecritures` excluent / considèrent justifiées les écritures pointées par un `remboursements.ecriture_id` — aucune copie de fichier, réversible.

**Tech Stack:** Next 16 (App Router, server actions), libsql/Turso, vitest, TypeScript. Spec : `doc/plans/2026-06-01-inbox-remboursements-link.md`.

**Commandes (toujours depuis `web/`) :**
- Typecheck : `npx tsc -p tsconfig.json --noEmit`
- Lint : `npx eslint <fichiers>`
- Test ciblé : `npx vitest run <fichier>`
- Suite : `npx vitest run`

---

## Task 1 : Généraliser la clé de rejet (`rejetPairKey`) à une cible typée

**Files:**
- Modify: `web/src/lib/queries/inbox-matching.ts`
- Modify: `web/src/lib/services/inbox-auto.ts:78` (appel `rejetPairKey`)
- Modify: `web/src/lib/queries/inbox-suggestions.test.ts` (appels `rejetPairKey`)

- [ ] **Step 1 : Mettre à jour le test pour la nouvelle signature**

Dans `inbox-suggestions.test.ts`, remplacer les 3 occurrences `rejetPairKey('E1', 'J1')` par `rejetPairKey('E1', 'depot', 'J1')` :

```ts
const rejected = new Set([rejetPairKey('E1', 'depot', 'J1')]);
```

(3 occurrences : lignes des tests « ne propose plus », « QUE la paire visée », « ne gêne pas une autre écriture ».)

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue à la compilation**

Run: `npx vitest run src/lib/queries/inbox-suggestions.test.ts`
Expected: FAIL (signature `rejetPairKey` attend 2 args).

- [ ] **Step 3 : Changer la signature dans `inbox-matching.ts`**

Remplacer la fonction `rejetPairKey` et son usage interne :

```ts
export type SuggestionTargetKind = 'depot' | 'remboursement';

// Clé stable d'une paire (écriture, cible) pour les Set en mémoire.
export function rejetPairKey(
  ecritureId: string,
  targetKind: SuggestionTargetKind,
  targetId: string,
): string {
  return `${ecritureId}::${targetKind}:${targetId}`;
}
```

Dans `computeAutoSuggestions`, mettre à jour l'appel :

```ts
if (rejectedPairs.has(rejetPairKey(ecr.id, 'depot', j.id))) continue;
```

- [ ] **Step 4 : Mettre à jour l'appel dans `inbox-auto.ts`**

Ligne ~78, dans la boucle de candidats :

```ts
if (rejectedPairs.has(rejetPairKey(e.id, 'depot', j.id))) continue;
```

- [ ] **Step 5 : Lancer le test, vérifier qu'il passe**

Run: `npx vitest run src/lib/queries/inbox-suggestions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6 : Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0 (aucune sortie). NB : `inbox-rejets.ts` re-exporte `rejetPairKey` et l'appelle dans `loadRejectedPairKeys` — il sera corrigé en Task 2, donc une erreur TS ici sur `inbox-rejets.ts` est attendue et sera résolue par la Task suivante. Si tu veux un typecheck vert dès maintenant, enchaîne Task 2 avant de commiter.

- [ ] **Step 7 : (différé) commit groupé avec Task 2** — voir Task 2 Step 7.

---

## Task 2 : Schéma de rejet générique + service `inbox-rejets`

**Files:**
- Modify: `web/src/lib/services/inbox-rejets.ts`

- [ ] **Step 1 : Réécrire `ensureInboxRejetsSchema` (forme générique + migration)**

Remplacer le corps de `ensureInboxRejetsSchema` :

```ts
export async function ensureInboxRejetsSchema(): Promise<void> {
  if (schemaEnsured) return;
  const db = getDb();

  // Forme cible : cible générique (depot | remboursement).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_suggestion_rejets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
      target_kind TEXT NOT NULL DEFAULT 'depot',
      target_id TEXT NOT NULL,
      rejected_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE (group_id, ecriture_id, target_kind, target_id)
    );
  `);

  // Migration des bases créées le 2026-06-01 avec l'ancienne forme
  // (depot_id NOT NULL, sans target_kind/target_id). SQLite ne permet
  // pas de relâcher NOT NULL → recreate en préservant les lignes.
  const cols = await db
    .prepare(`PRAGMA table_info(inbox_suggestion_rejets)`)
    .all<{ name: string }>();
  const names = new Set(cols.map((c) => c.name));
  if (names.has('depot_id') && !names.has('target_kind')) {
    await db.exec(`
      CREATE TABLE inbox_suggestion_rejets_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL REFERENCES groupes(id),
        ecriture_id TEXT NOT NULL REFERENCES ecritures(id),
        target_kind TEXT NOT NULL DEFAULT 'depot',
        target_id TEXT NOT NULL,
        rejected_by_user_id TEXT REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE (group_id, ecriture_id, target_kind, target_id)
      );
      INSERT INTO inbox_suggestion_rejets_v2
        (group_id, ecriture_id, target_kind, target_id, rejected_by_user_id, created_at)
        SELECT group_id, ecriture_id, 'depot', depot_id, rejected_by_user_id, created_at
        FROM inbox_suggestion_rejets;
      DROP TABLE inbox_suggestion_rejets;
      ALTER TABLE inbox_suggestion_rejets_v2 RENAME TO inbox_suggestion_rejets;
    `);
  }

  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_inbox_rejets_group ON inbox_suggestion_rejets(group_id);`,
  );
  schemaEnsured = true;
}
```

NB : la migration copie les lignes existantes (target_kind='depot') AVANT le DROP — aucune perte.

- [ ] **Step 2 : Mettre à jour l'import + re-export de `rejetPairKey`**

En tête de fichier :

```ts
import { rejetPairKey, type SuggestionTargetKind } from '../queries/inbox-matching';

// Ré-exporté pour les call-sites historiques (inbox-auto).
export { rejetPairKey };
```

- [ ] **Step 3 : Généraliser `rejectSuggestion`**

```ts
export async function rejectSuggestion(
  ctx: { groupId: string; userId?: string | null },
  ecritureId: string,
  targetKind: SuggestionTargetKind,
  targetId: string,
): Promise<void> {
  await ensureInboxRejetsSchema();
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO inbox_suggestion_rejets
         (group_id, ecriture_id, target_kind, target_id, rejected_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ctx.groupId, ecritureId, targetKind, targetId, ctx.userId ?? null, currentTimestamp());
}
```

- [ ] **Step 4 : Généraliser `loadRejectedPairKeys`**

```ts
export async function loadRejectedPairKeys(groupId: string): Promise<Set<string>> {
  await ensureInboxRejetsSchema();
  const rows = await getDb()
    .prepare(
      `SELECT ecriture_id, target_kind, target_id FROM inbox_suggestion_rejets WHERE group_id = ?`,
    )
    .all<{ ecriture_id: string; target_kind: string; target_id: string }>(groupId);
  return new Set(
    rows.map((r) =>
      rejetPairKey(r.ecriture_id, r.target_kind as SuggestionTargetKind, r.target_id),
    ),
  );
}
```

- [ ] **Step 5 : Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 6 : Suite de tests (non-régression)**

Run: `npx vitest run`
Expected: tous verts (les tests inbox existants utilisent encore le mock, OK).

- [ ] **Step 7 : Commit (Task 1 + 2)**

```bash
git add web/src/lib/queries/inbox-matching.ts web/src/lib/services/inbox-auto.ts \
        web/src/lib/queries/inbox-suggestions.test.ts web/src/lib/services/inbox-rejets.ts
git commit -m "refactor(inbox): rejet de suggestion à cible générique (depot|remboursement)"
```

---

## Task 3 : `computeRembSuggestions` (matching pur, TDD)

**Files:**
- Modify: `web/src/lib/queries/inbox-matching.ts`
- Test: `web/src/lib/queries/inbox-suggestions.test.ts`

- [ ] **Step 1 : Écrire les tests d'abord**

Ajouter à la fin de `inbox-suggestions.test.ts` (les helpers `ecr`/`jus` existent déjà en haut ; ajouter un helper `remb`) :

```ts
import { computeRembSuggestions, type RembCandidate } from './inbox-matching';

function remb(
  id: string,
  amount: number,
  datePaiement: string | null,
  dateDepense: string | null = null,
): RembCandidate {
  return {
    id,
    demandeur: id,
    amount_cents: amount,
    date_paiement: datePaiement,
    date_depense: dateDepense,
    status: 'virement_effectue',
    unite_code: null,
  };
}

describe('computeRembSuggestions — écriture ↔ remboursement', () => {
  it('apparie montant exact + date paiement ≤ 15 j', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2400, '2026-05-30')],
    );
    expect(out).toHaveLength(1);
    expect(out[0].ecriture.id).toBe('VIR1');
    expect(out[0].remboursement.id).toBe('R1');
  });

  it('rejette si montant non exact', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2401, '2026-05-30')],
    );
    expect(out).toHaveLength(0);
  });

  it('rejette si date > 15 j', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-30')],
      [remb('R1', 2400, '2026-06-01')],
    );
    expect(out).toHaveLength(0);
  });

  it('fallback sur date_depense si date_paiement null', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2400, null, '2026-05-29')],
    );
    expect(out).toHaveLength(1);
  });

  it('glouton 1:1 — un remboursement déjà apparié n’est pas réutilisé', () => {
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01'), ecr('VIR2', -2400, '2026-06-01')],
      [remb('R1', 2400, '2026-06-01')],
    );
    expect(out).toHaveLength(1);
  });

  it('paire rejetée non re-proposée ; le rembt suivant de même montant l’est', () => {
    const rejected = new Set([rejetPairKey('VIR1', 'remboursement', 'R1')]);
    const out = computeRembSuggestions(
      [ecr('VIR1', -2400, '2026-06-01')],
      [remb('R1', 2400, '2026-06-01'), remb('R2', 2400, '2026-06-02')],
      rejected,
    );
    expect(out).toHaveLength(1);
    expect(out[0].remboursement.id).toBe('R2');
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `npx vitest run src/lib/queries/inbox-suggestions.test.ts`
Expected: FAIL (`computeRembSuggestions` / `RembCandidate` non définis).

- [ ] **Step 3 : Implémenter dans `inbox-matching.ts`**

Ajouter après `computeAutoSuggestions` (réutilise la fonction privée `daysBetween` déjà présente) :

```ts
export interface RembCandidate {
  id: string;
  demandeur: string;
  amount_cents: number;
  date_paiement: string | null;
  date_depense: string | null;
  status: string;
  unite_code: string | null;
}

export interface RembSuggestion {
  ecriture: InboxEcriture;
  remboursement: RembCandidate;
  date_diff_days: number;
}

const REMB_DATE_TOLERANCE_DAYS = 15;

// Apparie les écritures de virement (dépense) avec les remboursements à
// rattacher : montant EXACT + date (date_paiement, sinon date_depense)
// ≤ 15 j. Glouton 1:1. Les paires rejetées ('remboursement') sont exclues.
export function computeRembSuggestions(
  ecritures: InboxEcriture[],
  rembs: RembCandidate[],
  rejectedPairs: Set<string> = new Set(),
): RembSuggestion[] {
  const out: RembSuggestion[] = [];
  const usedRembs = new Set<string>();

  for (const ecr of ecritures) {
    if (ecr.type !== 'depense') continue;
    const eAmount = Math.abs(ecr.amount_cents);
    let best: { remb: RembCandidate; dateDiff: number } | null = null;
    for (const r of rembs) {
      if (usedRembs.has(r.id)) continue;
      if (rejectedPairs.has(rejetPairKey(ecr.id, 'remboursement', r.id))) continue;
      if (Math.abs(r.amount_cents) !== eAmount) continue;
      const refDate = r.date_paiement ?? r.date_depense;
      if (!refDate) continue;
      const dateDiff = daysBetween(ecr.date_ecriture, refDate);
      if (dateDiff > REMB_DATE_TOLERANCE_DAYS) continue;
      if (best === null || dateDiff < best.dateDiff) best = { remb: r, dateDiff };
    }
    if (best) {
      usedRembs.add(best.remb.id);
      out.push({ ecriture: ecr, remboursement: best.remb, date_diff_days: best.dateDiff });
    }
  }
  return out;
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `npx vitest run src/lib/queries/inbox-suggestions.test.ts`
Expected: PASS (10 tests : 4 dépôt + 6 remboursement).

- [ ] **Step 5 : Typecheck + commit**

Run: `npx tsc -p tsconfig.json --noEmit` (exit 0)

```bash
git add web/src/lib/queries/inbox-matching.ts web/src/lib/queries/inbox-suggestions.test.ts
git commit -m "feat(inbox): computeRembSuggestions — matching écriture↔remboursement (pur, testé)"
```

---

## Task 4 : Données inbox — charger les remboursements, exclure les écritures liées

**Files:**
- Modify: `web/src/lib/queries/inbox.ts`

- [ ] **Step 1 : Importer le nouveau matching + types**

Dans le bloc d'import depuis `./inbox-matching`, ajouter `computeRembSuggestions`, `RembCandidate`, `RembSuggestion`, et les re-exporter :

```ts
import {
  computeAutoSuggestions,
  computeRembSuggestions,
  type InboxEcriture,
  type InboxJustif,
  type InboxSuggestion,
  type RembCandidate,
  type RembSuggestion,
} from './inbox-matching';

export type {
  InboxEcriture,
  InboxJustif,
  InboxSuggestion,
  RembCandidate,
  RembSuggestion,
} from './inbox-matching';
```

- [ ] **Step 2 : Ajouter `rembSuggestions` à `InboxData`**

```ts
export interface InboxData {
  suggestions: InboxSuggestion[];
  rembSuggestions: RembSuggestion[];
  ecrituresOrphelines: InboxEcriture[];
  justifsOrphelins: InboxJustif[];
  totalCount: number;
  ecrituresTruncated: number;
}
```

- [ ] **Step 3 : Exclure les écritures déjà liées à un remboursement (orphelines)**

Dans `listInboxItems`, dans le tableau `conditions` de la requête écritures, ajouter une condition après le `NOT EXISTS` justificatifs :

```ts
    `NOT EXISTS (
       SELECT 1 FROM remboursements r
       WHERE r.ecriture_id = e.id
     )`,
```

- [ ] **Step 4 : Charger les remboursements à rattacher + calculer les suggestions rembt**

Dans `listInboxItems`, remplacer le bloc de calcul des suggestions (actuellement `const rejectedPairs = ...; const suggestions = computeAutoSuggestions(...)`) par :

```ts
  const rembsARattacher = await db
    .prepare(
      `SELECT r.id, r.demandeur, r.amount_cents, r.date_paiement, r.date_depense,
              r.status, un.code AS unite_code
       FROM remboursements r
       LEFT JOIN unites un ON un.id = r.unite_id
       WHERE r.group_id = ?
         AND r.ecriture_id IS NULL
         AND r.status IN ('virement_effectue', 'termine')
       ORDER BY r.date_paiement DESC, r.date_depense DESC`,
    )
    .all<RembCandidate>(groupId);

  const rejectedPairs = await loadRejectedPairKeys(groupId);

  // 1) Suggestions remboursement (montant exact) sur toutes les orphelines.
  const rembSuggestions = computeRembSuggestions(
    ecrituresAll,
    rembsARattacher,
    rejectedPairs,
  );
  const usedEcrByRemb = new Set(rembSuggestions.map((s) => s.ecriture.id));

  // 2) Suggestions dépôt sur les écritures restantes (évite qu'une même
  //    écriture soit proposée des deux côtés).
  const suggestions = computeAutoSuggestions(
    ecrituresAll.filter((e) => !usedEcrByRemb.has(e.id)),
    justifsOrphelins,
    rejectedPairs,
  );

  const usedEcr = new Set<string>([
    ...suggestions.map((s) => s.ecriture.id),
    ...usedEcrByRemb,
  ]);
  const usedJustif = new Set(suggestions.map((s) => s.justif.id));
```

- [ ] **Step 5 : Ajouter `rembSuggestions` au retour de `listInboxItems`**

Dans l'objet retourné :

```ts
  return {
    suggestions,
    rembSuggestions,
    ecrituresOrphelines: remainingEcritures,
    justifsOrphelins: remainingJustifs,
    totalCount: ecrituresAll.length + justifsOrphelins.length,
    ecrituresTruncated,
  };
```

- [ ] **Step 6 : Même exclusion dans `countInboxItems`**

Dans la requête `COUNT(*)` des écritures de `countInboxItems`, ajouter à la clause WHERE :

```sql
           AND NOT EXISTS (
             SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id
           )
```

- [ ] **Step 7 : Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0 (la page inbox lira `rembSuggestions` en Task 6 ; comme c'est un champ ajouté, pas d'erreur sur les consommateurs existants).

- [ ] **Step 8 : Commit**

```bash
git add web/src/lib/queries/inbox.ts
git commit -m "feat(inbox): charge les remboursements à rattacher + exclut les écritures déjà liées"
```

---

## Task 5 : Actions inbox — lier à un remboursement + rejet généralisé

**Files:**
- Modify: `web/src/lib/actions/inbox.ts`

- [ ] **Step 1 : Importer le service de lien rembt**

En tête, après l'import `rejectSuggestion` :

```ts
import { setRembsEcritureLink } from '../services/remboursement-ecriture-link';
```

- [ ] **Step 2 : Action `lierEcritureRemboursement`**

Ajouter (après `lierEcritureJustif`) :

```ts
// Lie une écriture de virement orpheline à son remboursement. Pose
// `remboursements.ecriture_id` via le service partagé (garde-fous :
// écriture introuvable / déjà liée à un autre rembt). Le lien logique
// fait disparaître l'écriture des orphelines au rendu suivant.
export async function lierEcritureRemboursement(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!isAdminRole(ctx.role)) {
    redirect(buildInboxRedirect(formData, { error: 'Action réservée aux trésoriers / RG.' }));
  }
  const ecritureId = formData.get('ecriture_id') as string | null;
  const remboursementId = formData.get('remboursement_id') as string | null;
  if (!ecritureId || !remboursementId) {
    redirect(buildInboxRedirect(formData, { error: 'Écriture et remboursement requis.' }));
  }
  const result = await setRembsEcritureLink(ctx.groupId, remboursementId!, ecritureId!);
  if (!result.ok) {
    redirect(buildInboxRedirect(formData, { error: result.error }));
  }
  revalidatePath('/inbox');
  revalidatePath('/remboursements');
  revalidatePath(`/remboursements/${remboursementId}`);
  revalidatePath(`/ecritures/${ecritureId}`);
  redirect(buildInboxRedirect(formData, { rbt_linked: remboursementId! }));
}
```

- [ ] **Step 3 : Généraliser `rejeterSuggestionInbox`**

Remplacer le corps de lecture des champs + l'appel service de `rejeterSuggestionInbox` :

```ts
  const ecritureId = formData.get('ecriture_id') as string | null;
  const targetKind =
    ((formData.get('target_kind') as string | null) ?? 'depot') as
      | 'depot'
      | 'remboursement';
  const targetId =
    (formData.get('target_id') as string | null) ??
    (formData.get('depot_id') as string | null);
  if (!ecritureId || !targetId) {
    redirect(buildInboxRedirect(formData, { error: 'Écriture et cible requises.' }));
  }
  try {
    await rejectSuggestionService(
      { groupId: ctx.groupId, userId: ctx.userId },
      ecritureId!,
      targetKind,
      targetId!,
    );
  } catch (err) {
    redirect(
      buildInboxRedirect(formData, {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  revalidatePath('/inbox');
  redirect(buildInboxRedirect(formData, { suggestion_rejetee: '1' }));
```

(Le `rejectSuggestionService` est déjà importé ; sa signature a changé en Task 2.)

- [ ] **Step 4 : Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/actions/inbox.ts
git commit -m "feat(inbox): action lierEcritureRemboursement + rejet généralisé (target_kind/id)"
```

---

## Task 6 : UI inbox — suggestions unifiées (dépôt + remboursement)

**Files:**
- Modify: `web/src/app/(app)/inbox/page.tsx`

- [ ] **Step 1 : Imports**

Ajouter l'icône remboursement + l'action + le type :

```ts
import { ArrowRight, Link2, Paperclip, Wallet, X } from 'lucide-react';
import {
  lierEcritureJustif,
  lierEcritureRemboursement,
  rejeterSuggestionInbox,
} from '@/lib/actions/inbox';
```

Et dans l'import depuis `@/lib/queries/inbox`, ajouter `type RembSuggestion`.

- [ ] **Step 2 : Inclure `rembSuggestions` dans le compteur + le rendu**

Dans `InboxPage`, mettre à jour `totalRemaining` :

```ts
  const totalRemaining =
    inbox.suggestions.length +
    inbox.rembSuggestions.length +
    inbox.ecrituresOrphelines.length +
    inbox.justifsOrphelins.length;
```

Et la condition de rendu de la section suggestions :

```tsx
          {(inbox.suggestions.length > 0 || inbox.rembSuggestions.length > 0) && (
            <SuggestionsSection
              suggestions={inbox.suggestions}
              rembSuggestions={inbox.rembSuggestions}
              period={period}
              includeRecettes={includeRecettes}
            />
          )}
```

- [ ] **Step 3 : Flash `rbt_linked`**

Dans `SearchParams`, ajouter `rbt_linked?: string;`. Après le bloc `params.suggestion_rejetee`, ajouter :

```tsx
      {params.rbt_linked && (
        <Alert variant="success" className="mb-4">
          Remboursement{' '}
          <code className="font-mono text-[12.5px] font-medium">{params.rbt_linked}</code>{' '}
          relié à son écriture de virement. Le process est bouclé.
        </Alert>
      )}
```

- [ ] **Step 4 : Réécrire `SuggestionsSection` en liste unifiée**

Remplacer toute la fonction `SuggestionsSection` par :

```tsx
function SuggestionsSection({
  suggestions,
  rembSuggestions,
  period,
  includeRecettes,
}: {
  suggestions: InboxSuggestion[];
  rembSuggestions: RembSuggestion[];
  period: InboxPeriod;
  includeRecettes: boolean;
}) {
  const total = suggestions.length + rembSuggestions.length;
  return (
    <section>
      <SectionTitle
        icon="✨"
        label={`Suggestions automatiques (${total})`}
        sub="Montant et date concordent. Un clic pour valider."
      />
      <ul className="space-y-2">
        {rembSuggestions.map((s) => (
          <li
            key={`remb-${s.ecriture.id}-${s.remboursement.id}`}
            className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-border-soft bg-bg-elevated p-3"
          >
            <div className="flex-1 min-w-0">
              <EcritureSummary ecriture={s.ecriture} compact />
            </div>
            <ArrowRight size={16} className="hidden sm:block text-fg-subtle shrink-0" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <RembSummary remboursement={s.remboursement} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <form action={rejeterSuggestionInbox}>
                <input type="hidden" name="ecriture_id" value={s.ecriture.id} />
                <input type="hidden" name="target_kind" value="remboursement" />
                <input type="hidden" name="target_id" value={s.remboursement.id} />
                <input type="hidden" name="return_period" value={period} />
                <input type="hidden" name="return_recettes" value={includeRecettes ? '1' : '0'} />
                <PendingButton
                  variant="ghost"
                  size="sm"
                  pendingLabel="…"
                  title="Pas ça — ne plus proposer cette paire"
                  className="text-fg-subtle hover:text-destructive"
                >
                  <X size={12} strokeWidth={2} className="mr-1" />
                  Pas ça
                </PendingButton>
              </form>
              <form action={lierEcritureRemboursement}>
                <input type="hidden" name="ecriture_id" value={s.ecriture.id} />
                <input type="hidden" name="remboursement_id" value={s.remboursement.id} />
                <input type="hidden" name="return_period" value={period} />
                <input type="hidden" name="return_recettes" value={includeRecettes ? '1' : '0'} />
                <PendingButton size="sm">
                  <Link2 size={12} strokeWidth={2} className="mr-1" />
                  Lier
                </PendingButton>
              </form>
            </div>
          </li>
        ))}
        {suggestions.map((s) => (
          <li
            key={`depot-${s.ecriture.id}-${s.justif.id}`}
            className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-border-soft bg-bg-elevated p-3"
          >
            <div className="flex-1 min-w-0">
              <EcritureSummary ecriture={s.ecriture} compact />
            </div>
            <ArrowRight size={16} className="hidden sm:block text-fg-subtle shrink-0" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <JustifSummary justif={s.justif} compact />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <form action={rejeterSuggestionInbox}>
                <input type="hidden" name="ecriture_id" value={s.ecriture.id} />
                <input type="hidden" name="target_kind" value="depot" />
                <input type="hidden" name="target_id" value={s.justif.id} />
                <input type="hidden" name="return_period" value={period} />
                <input type="hidden" name="return_recettes" value={includeRecettes ? '1' : '0'} />
                <PendingButton
                  variant="ghost"
                  size="sm"
                  pendingLabel="…"
                  title="Pas ça — ne plus proposer cette paire"
                  className="text-fg-subtle hover:text-destructive"
                >
                  <X size={12} strokeWidth={2} className="mr-1" />
                  Pas ça
                </PendingButton>
              </form>
              <form action={lierEcritureJustif}>
                <input type="hidden" name="ecriture_id" value={s.ecriture.id} />
                <input type="hidden" name="depot_id" value={s.justif.id} />
                <input type="hidden" name="return_period" value={period} />
                <input type="hidden" name="return_recettes" value={includeRecettes ? '1' : '0'} />
                <PendingButton size="sm">
                  <Link2 size={12} strokeWidth={2} className="mr-1" />
                  Lier
                </PendingButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5 : Composant `RembSummary`**

Ajouter près de `JustifSummary` :

```tsx
function RembSummary({ remboursement }: { remboursement: RembSuggestion['remboursement'] }) {
  const refDate = remboursement.date_paiement ?? remboursement.date_depense;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 inline-flex items-center gap-1">
          <Wallet size={10} strokeWidth={2} />
          Remboursement
        </span>
        <Link
          href={`/remboursements/${remboursement.id}`}
          className="flex-1 min-w-0 truncate text-[13px] font-medium text-brand hover:underline"
        >
          {remboursement.demandeur}
        </Link>
        <span className="tabular-nums font-semibold text-[13.5px] shrink-0">
          <Amount cents={remboursement.amount_cents} tone="negative" />
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="font-mono">{remboursement.id}</span>
        {refDate && <span className="tabular-nums">· virement {refDate}</span>}
        {remboursement.unite_code && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand">
            {remboursement.unite_code}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6 : Typecheck + lint**

Run: `npx tsc -p tsconfig.json --noEmit` (exit 0)
Run: `npx eslint "src/app/(app)/inbox/page.tsx"` (exit 0)

- [ ] **Step 7 : Commit**

```bash
git add "web/src/app/(app)/inbox/page.tsx"
git commit -m "feat(inbox): suggestions unifiées dépôt + remboursement (badge, lier, Pas ça)"
```

---

## Task 7 : Écriture liée à un remboursement = justifiée (logique + badge)

**Files:**
- Modify: `web/src/lib/services/ecritures.ts`
- Modify: `web/src/lib/types.ts` (champ `remboursement_id`)
- Modify: `web/src/app/(app)/ecritures/[id]/page.tsx` (badge fiche)

- [ ] **Step 1 : Ajouter `remboursement_id` au type `Ecriture`**

Dans `types.ts`, interface `Ecriture`, près de `has_justificatif?: boolean;` :

```ts
  // Renseigné (lecture) si un remboursement pointe cette écriture
  // (remboursements.ecriture_id) — son justif est la feuille de rembt.
  remboursement_id?: string | null;
```

- [ ] **Step 2 : `computeMissingFields` — ne pas exiger de justif si liée à un rembt**

Dans `services/ecritures.ts`, étendre le type du paramètre et la condition :

```ts
export function computeMissingFields(e: {
  status: string;
  category_id: string | null;
  activite_id: string | null;
  unite_id: string | null;
  mode_paiement_id: string | null;
  type: string;
  numero_piece: string | null;
  justif_attendu: number;
  has_justificatif?: boolean;
  remboursement_id?: string | null;
}): string[] {
```

et :

```ts
  if (
    e.type === 'depense' &&
    e.justif_attendu === 1 &&
    !e.has_justificatif &&
    !e.remboursement_id
  ) {
    missing.push('justif');
  }
```

- [ ] **Step 3 : SELECT — exposer `remboursement_id`**

Dans la requête de `listEcritures` (le grand SELECT), ajouter après la sous-requête `has_justificatif` :

```sql
       (SELECT r.id FROM remboursements r WHERE r.ecriture_id = e.id LIMIT 1) as remboursement_id,
```

(Le `rows.map((e) => ({ ...e, missing_fields: computeMissingFields(e) }))` propage `remboursement_id` automatiquement vers `computeMissingFields` et vers l'objet retourné.)

- [ ] **Step 4 : Filtre `incomplete` — exclure les écritures liées à un rembt**

Dans `listEcritures`, branche `filters.incomplete`, modifier la sous-condition justif :

```ts
      OR (e.type = 'depense' AND e.justif_attendu = 1
          AND NOT EXISTS (
            SELECT 1 FROM justificatifs j
            WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id
          ))
```

- [ ] **Step 5 : Test de `computeMissingFields`**

Vérifier qu'un test existe pour `computeMissingFields` ; sinon ajouter dans `web/src/lib/services/__tests__/ecritures.test.ts` (créer si absent) :

```ts
import { describe, it, expect } from 'vitest';
import { computeMissingFields } from '../ecritures';

describe('computeMissingFields — justif via remboursement', () => {
  const base = {
    status: 'mirror',
    category_id: 'c', activite_id: 'a', unite_id: 'u', mode_paiement_id: 'm',
    type: 'depense', numero_piece: 'P1', justif_attendu: 1,
  };
  it('dépense sans justif ni rembt → justif manquant', () => {
    expect(computeMissingFields({ ...base, has_justificatif: false })).toContain('justif');
  });
  it('dépense liée à un remboursement → justif NON manquant', () => {
    expect(
      computeMissingFields({ ...base, has_justificatif: false, remboursement_id: 'RBT-1' }),
    ).not.toContain('justif');
  });
});
```

Run: `npx vitest run src/lib/services/__tests__/ecritures.test.ts`
Expected: PASS.

- [ ] **Step 6 : Badge « justifiée par RBT » sur la fiche écriture**

Ouvrir `web/src/app/(app)/ecritures/[id]/page.tsx`, repérer l'endroit où le statut justif / `missing_fields` est affiché. Ajouter, quand `ecriture.remboursement_id` est défini, un badge :

```tsx
{ecriture.remboursement_id && (
  <Link
    href={`/remboursements/${ecriture.remboursement_id}`}
    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-medium text-emerald-900 hover:underline dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
  >
    Justifiée par le remboursement {ecriture.remboursement_id}
  </Link>
)}
```

NB : la fiche écriture doit recevoir l'écriture via une query qui expose `remboursement_id`. Si la fiche utilise `getEcriture`/équivalent au lieu de `listEcritures`, ajouter la même sous-requête `remboursement_id` à cette query (vérifier `web/src/lib/queries/ecritures.ts` au moment de l'implémentation et répliquer le SELECT de Step 3).

- [ ] **Step 7 : Typecheck + lint + suite complète**

Run: `npx tsc -p tsconfig.json --noEmit` (exit 0)
Run: `npx eslint src/lib/services/ecritures.ts "src/app/(app)/ecritures/[id]/page.tsx"` (exit 0)
Run: `npx vitest run` (tous verts)

- [ ] **Step 8 : Commit**

```bash
git add web/src/lib/types.ts web/src/lib/services/ecritures.ts \
        web/src/lib/services/__tests__/ecritures.test.ts \
        "web/src/app/(app)/ecritures/[id]/page.tsx" web/src/lib/queries/ecritures.ts
git commit -m "feat(ecritures): une écriture liée à un remboursement compte comme justifiée (+ badge)"
```

---

## Task 8 : Vérification end-to-end + non-régression

**Files:** aucun (vérification).

- [ ] **Step 1 : Suite complète + typecheck + lint global**

Run: `npx vitest run` (tous verts)
Run: `npx tsc -p tsconfig.json --noEmit` (exit 0)
Run: `npx eslint "src/app/(app)/inbox/page.tsx" src/lib/queries/inbox.ts src/lib/queries/inbox-matching.ts src/lib/services/inbox-rejets.ts src/lib/services/inbox-auto.ts src/lib/actions/inbox.ts src/lib/services/ecritures.ts` (exit 0)

- [ ] **Step 2 : Revue manuelle du flux (dev server)**

Lancer l'app (`npm run dev` dans `web/`), se connecter en trésorier, puis vérifier :
1. Inbox : une écriture de virement (montant = un remboursement viré non lié) apparaît dans « Suggestions automatiques » avec le badge **Remboursement**.
2. Clic **Lier** → flash succès `rbt_linked` ; la suggestion disparaît ; l'écriture quitte « écritures sans justif ».
3. `/remboursements` : la demande passe « à rattacher » → liée (colonne Écriture).
4. `/ecritures` (fiche de l'écriture) : badge **« Justifiée par le remboursement RBT-… »**.
5. Sur une fausse paire (deux rembts de même montant) : **Pas ça** l'écarte, le suivant est proposé.
6. Délier depuis la fiche remboursement → l'écriture réapparaît dans l'inbox (réversibilité du lien logique).

- [ ] **Step 3 : (optionnel) mettre à jour le spec en « implémenté »**

Passer l'en-tête du spec `doc/plans/2026-06-01-inbox-remboursements-link.md` à `Statut : implémenté`.

---

## Self-review (couverture spec)

- §1 Matching → Task 3 (`computeRembSuggestions`) ✓
- §1 clé rejet générique → Task 1 ✓
- §2 rejet généralisé (schéma + service) → Task 2 ✓
- §3 lien logique (inbox exclut, ecritures justifiées, badge) → Task 4 (inbox) + Task 7 (ecritures) ✓
- §4 données inbox (charge rembts, union) → Task 4 (données) + Task 6 (union UI) ✓
- §5 UI inbox suggestions unifiées → Task 6 ✓
- §6 actions (lier + rejet) → Task 5 ✓
- Tests → Task 3 (matching), Task 7 (missing-fields), Task 8 (e2e) ✓

Écart assumé vs spec : la spec évoquait une « union discriminée dans `InboxData` ». Choix d'implémentation : `InboxData` garde `suggestions` (dépôt) + ajoute `rembSuggestions` (deux tableaux typés) ; l'union est construite au rendu dans `SuggestionsSection`. Moins intrusif (ne casse aucun consommateur de `InboxData.suggestions`), même résultat visuel.
