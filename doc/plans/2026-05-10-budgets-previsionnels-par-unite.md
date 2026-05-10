# Budgets prévisionnels par unité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre la saisie et l'édition des budgets prévisionnels par saison, unité et activité, et afficher prévu vs réel sur `/synthese` (barre de progression) et `/synthese/unite/[id]` (colonne Budget + bloc Par activité).

**Architecture:** Migration ALTER TABLE pour ajouter `budget_lignes.activite_id`. Compléter le service `budgets.ts` (update + delete + agrégation prévu par unité/activité). Nouvelle page `/budgets` avec édition inline via server actions. Intégration sans refonte sur `/synthese` et page détail unité.

**Tech Stack:** Next 16 (App Router, server components, server actions, force-dynamic), libsql/Turso, Tailwind, lucide-react, zod, vitest. Aucune nouvelle dépendance.

**Spec source :** [`doc/specs/2026-05-10-budgets-previsionnels-par-unite-design.md`](../specs/2026-05-10-budgets-previsionnels-par-unite-design.md)

**Tests :** Pattern projet — pas de tests unitaires sur services BDD-coupled, vérification manuelle documentée par tâche.

---

## File Structure

**Modifié :**
- `web/src/lib/auth/schema.ts` — ALTER TABLE `budget_lignes` ADD COLUMN `activite_id` + INDEX (migration idempotente)
- `web/src/lib/db/business-schema.ts` — ajoute `activite_id` au CREATE TABLE déclaratif (pour BDD vierges)
- `web/src/lib/services/budgets.ts` — ajoute `activite_id` au CREATE + nouvelles fonctions `updateBudgetLigne`, `deleteBudgetLigne`, `getBudgetPrevuParUnite`, `updateBudgetStatut`
- `web/src/lib/services/overview.ts` — joint le prévu de la saison correspondant à l'exercice dans `parUnite` et `UniteOverviewData`
- `web/src/components/synthese/unite-card.tsx` — accepte un prop `budget` et affiche une barre de progression
- `web/src/app/(app)/synthese/page.tsx` — passe le `budget` à chaque `UniteCard`
- `web/src/app/(app)/synthese/unite/[id]/page.tsx` — colonne « Budget » sur la table catégorie + nouveau bloc « Par activité »
- `web/src/components/layout/sidebar.tsx` — ajoute item de menu « Budget »

**Créé :**
- `web/src/app/api/budgets/[id]/lignes/[ligneId]/route.ts` — `PATCH` et `DELETE`
- `web/src/lib/actions/budgets.ts` — server actions `createBudgetLigneAction`, `updateBudgetLigneAction`, `deleteBudgetLigneAction`, `updateBudgetStatutAction`
- `web/src/app/(app)/budgets/page.tsx` — server component principal
- `web/src/components/budgets/budget-form.tsx` — client component d'édition inline

---

## Task 1 — Migration BDD : `budget_lignes.activite_id`

**Files:**
- Modify: `web/src/lib/auth/schema.ts` (zone des migrations idempotentes)
- Modify: `web/src/lib/db/business-schema.ts` (zone `CREATE TABLE budget_lignes`)

- [ ] **Step 1 : Ajouter la migration idempotente dans `auth/schema.ts`**

Repérer la zone des migrations idempotentes après les ALTER TABLE existants pour `mouvements_caisse`. Ajouter à la fin (avant la fermeture de la fonction) :

```ts
// Phase 2 budgets : ajout du lien activité sur les lignes budget pour
// la réconciliation prévu vs réel. Idempotent.
const bdgCols = await db
  .prepare('PRAGMA table_info(budget_lignes)')
  .all<{ name: string }>();
const hasBdg = (name: string) => bdgCols.some((c) => c.name === name);
if (!hasBdg('activite_id')) {
  await db.exec('ALTER TABLE budget_lignes ADD COLUMN activite_id TEXT REFERENCES activites(id)');
}
// CREATE INDEX après l'ALTER (cf. piège documenté dans AGENTS.md :
// CREATE TABLE IF NOT EXISTS étant no-op sur les BDDs prod, l'index
// dans business-schema.ts planterait avant que la colonne existe).
await db.exec(
  'CREATE INDEX IF NOT EXISTS idx_budget_lignes_activite ON budget_lignes(activite_id)',
);
```

- [ ] **Step 2 : Ajouter la colonne au CREATE TABLE déclaratif (BDD vierges)**

Dans `web/src/lib/db/business-schema.ts`, repérer le `CREATE TABLE IF NOT EXISTS budget_lignes` (autour de la ligne 424). Modifier pour inclure `activite_id` :

```sql
CREATE TABLE IF NOT EXISTS budget_lignes (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  unite_id TEXT REFERENCES unites(id),
  category_id TEXT REFERENCES categories(id),
  activite_id TEXT REFERENCES activites(id),
  libelle TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
  amount_cents INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_budget_lignes_budget ON budget_lignes(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_lignes_unite ON budget_lignes(unite_id);
```

⚠️ **Ne pas** ajouter `CREATE INDEX idx_budget_lignes_activite` ici — il est dans `auth/schema.ts` après l'ALTER (pour éviter le crash sur prod où la colonne n'existe pas encore au moment où `business-schema.ts` tourne).

- [ ] **Step 3 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Smoke test schema (boot local)**

Run: `cd web && pnpm dev` (laisse tourner 5s pour que le schema s'ensure)
Ouvre `http://localhost:3000/synthese` — la page doit charger sans erreur 500.
Arrête le dev server.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/auth/schema.ts web/src/lib/db/business-schema.ts
git commit -m "feat(budgets): ajoute budget_lignes.activite_id pour reconciliation prevu/reel"
```

---

## Task 2 — Service budgets : `activite_id` sur create + update + delete

**Files:**
- Modify: `web/src/lib/services/budgets.ts`

- [ ] **Step 1 : Étendre `BudgetLigne` et `CreateBudgetLigneInput`**

Dans `web/src/lib/services/budgets.ts`, modifier l'interface `BudgetLigne` et `CreateBudgetLigneInput` pour ajouter `activite_id` :

```ts
export interface BudgetLigne {
  id: string;
  budget_id: string;
  unite_id: string | null;
  category_id: string | null;
  activite_id: string | null;  // NEW
  libelle: string;
  type: BudgetLigneType;
  amount_cents: number;
  notes: string | null;
}

export interface CreateBudgetLigneInput {
  budget_id: string;
  libelle: string;
  type: BudgetLigneType;
  amount_cents: number;
  unite_id?: string | null;
  category_id?: string | null;
  activite_id?: string | null;  // NEW
  notes?: string | null;
}
```

- [ ] **Step 2 : Étendre `createBudgetLigne` pour persister `activite_id`**

Modifier la requête INSERT et les bind values :

```ts
await getDb().prepare(
  `INSERT INTO budget_lignes (id, budget_id, unite_id, category_id, activite_id, libelle, type, amount_cents, notes, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  id,
  input.budget_id,
  input.unite_id ?? null,
  input.category_id ?? null,
  input.activite_id ?? null,
  input.libelle,
  input.type,
  input.amount_cents,
  input.notes ?? null,
  now,
  now,
);
```

- [ ] **Step 3 : Étendre `listBudgetLignes` pour SELECT `activite_id`**

Modifier la query SQL :

```ts
const lignes = await getDb().prepare(
  `SELECT bl.id, bl.budget_id, bl.unite_id, bl.category_id, bl.activite_id, bl.libelle, bl.type, bl.amount_cents, bl.notes
   FROM budget_lignes bl
   JOIN budgets b ON b.id = bl.budget_id
   WHERE bl.budget_id = ? AND b.group_id = ?
   ORDER BY bl.type, bl.libelle`,
).all<BudgetLigne>(budgetId, groupId);
```

- [ ] **Step 4 : Ajouter `updateBudgetLigne`**

À la fin du fichier, ajouter :

```ts
export type UpdateBudgetLigneInput = Partial<{
  libelle: string;
  type: BudgetLigneType;
  amount_cents: number;
  unite_id: string | null;
  category_id: string | null;
  activite_id: string | null;
  notes: string | null;
}>;

// Patch partiel d'une ligne budget. Anti-énumération via JOIN sur
// budgets : si la ligne n'appartient pas à un budget du groupe courant,
// retourne null (la route handler répond 404).
export async function updateBudgetLigne(
  { groupId }: BudgetContext,
  ligneId: string,
  patch: UpdateBudgetLigneInput,
): Promise<BudgetLigne | null> {
  const db = getDb();
  const owned = await db
    .prepare(
      `SELECT bl.id FROM budget_lignes bl
       JOIN budgets b ON b.id = bl.budget_id
       WHERE bl.id = ? AND b.group_id = ?`,
    )
    .get<{ id: string }>(ligneId, groupId);
  if (!owned) return null;

  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.libelle !== undefined) { sets.push('libelle = ?'); values.push(patch.libelle); }
  if (patch.type !== undefined) { sets.push('type = ?'); values.push(patch.type); }
  if (patch.amount_cents !== undefined) { sets.push('amount_cents = ?'); values.push(patch.amount_cents); }
  if (patch.unite_id !== undefined) { sets.push('unite_id = ?'); values.push(patch.unite_id); }
  if (patch.category_id !== undefined) { sets.push('category_id = ?'); values.push(patch.category_id); }
  if (patch.activite_id !== undefined) { sets.push('activite_id = ?'); values.push(patch.activite_id); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes); }
  if (sets.length === 0) {
    return (await db.prepare('SELECT * FROM budget_lignes WHERE id = ?').get<BudgetLigne>(ligneId))!;
  }
  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(ligneId);
  await db.prepare(`UPDATE budget_lignes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return (await db.prepare('SELECT * FROM budget_lignes WHERE id = ?').get<BudgetLigne>(ligneId))!;
}
```

- [ ] **Step 5 : Ajouter `deleteBudgetLigne`**

```ts
// DELETE simple. Le prévisionnel n'est pas concerné par la doctrine
// "jamais de DELETE" (qui vise écritures, justifs, rembs, etc.). Anti-
// énumération : retourne false si la ligne n'appartient pas au groupe.
export async function deleteBudgetLigne(
  { groupId }: BudgetContext,
  ligneId: string,
): Promise<boolean> {
  const db = getDb();
  const owned = await db
    .prepare(
      `SELECT bl.id FROM budget_lignes bl
       JOIN budgets b ON b.id = bl.budget_id
       WHERE bl.id = ? AND b.group_id = ?`,
    )
    .get<{ id: string }>(ligneId, groupId);
  if (!owned) return false;
  await db.prepare('DELETE FROM budget_lignes WHERE id = ?').run(ligneId);
  return true;
}
```

- [ ] **Step 6 : Ajouter `updateBudgetStatut`**

```ts
// Change le statut d'un budget (projet → vote → cloture). Pas de check
// SQL côté code : libre, validation au niveau UI.
export async function updateBudgetStatut(
  { groupId }: BudgetContext,
  budgetId: string,
  statut: BudgetStatut,
): Promise<Budget | null> {
  const db = getDb();
  const owned = await db
    .prepare('SELECT id FROM budgets WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(budgetId, groupId);
  if (!owned) return null;
  const now = currentTimestamp();
  const voteLe = statut === 'vote' ? now.slice(0, 10) : null;
  await db
    .prepare('UPDATE budgets SET statut = ?, vote_le = COALESCE(?, vote_le), updated_at = ? WHERE id = ?')
    .run(statut, voteLe, now, budgetId);
  return (await db.prepare('SELECT * FROM budgets WHERE id = ?').get<Budget>(budgetId))!;
}
```

Note : `vote_le` est posé uniquement quand on passe en `vote` (la date du vote). On garde la valeur existante via `COALESCE` si on repasse en projet puis revote.

- [ ] **Step 7 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 8 : Commit**

```bash
git add web/src/lib/services/budgets.ts
git commit -m "feat(budgets): update/delete ligne + updateStatut + activite_id"
```

---

## Task 3 — Service : `getBudgetPrevuParUnite`

**Files:**
- Modify: `web/src/lib/services/budgets.ts`

- [ ] **Step 1 : Ajouter les types et la fonction**

À la fin de `web/src/lib/services/budgets.ts`, ajouter :

```ts
export interface BudgetPrevuParUnite {
  unite_id: string;
  prevu_depenses_cents: number;
  prevu_recettes_cents: number;
}
export interface BudgetPrevuParUniteActivite {
  unite_id: string;
  activite_id: string | null;
  activite_name: string | null;
  prevu_depenses_cents: number;
  prevu_recettes_cents: number;
}
export interface BudgetPrevuResult {
  parUnite: BudgetPrevuParUnite[];
  parUniteActivite: BudgetPrevuParUniteActivite[];
}

// Agrégation du prévu pour une saison donnée. Pas de filtre exercice
// (1 saison budget = 1 exercice SGDF, cf. spec phase 2). Si le budget
// n'existe pas pour cette saison, renvoie des tableaux vides (pas
// d'erreur — l'UI affichera 0 / "Pas de budget").
export async function getBudgetPrevuParUnite(
  { groupId }: BudgetContext,
  saison: string,
): Promise<BudgetPrevuResult> {
  const db = getDb();
  const budget = await db
    .prepare('SELECT id FROM budgets WHERE group_id = ? AND saison = ?')
    .get<{ id: string }>(groupId, saison);
  if (!budget) return { parUnite: [], parUniteActivite: [] };

  const parUnite = await db
    .prepare(
      `SELECT bl.unite_id,
              COALESCE(SUM(CASE WHEN bl.type = 'depense' THEN bl.amount_cents ELSE 0 END), 0) as prevu_depenses_cents,
              COALESCE(SUM(CASE WHEN bl.type = 'recette' THEN bl.amount_cents ELSE 0 END), 0) as prevu_recettes_cents
       FROM budget_lignes bl
       WHERE bl.budget_id = ? AND bl.unite_id IS NOT NULL
       GROUP BY bl.unite_id`,
    )
    .all<BudgetPrevuParUnite>(budget.id);

  const parUniteActivite = await db
    .prepare(
      `SELECT bl.unite_id, bl.activite_id, a.name as activite_name,
              COALESCE(SUM(CASE WHEN bl.type = 'depense' THEN bl.amount_cents ELSE 0 END), 0) as prevu_depenses_cents,
              COALESCE(SUM(CASE WHEN bl.type = 'recette' THEN bl.amount_cents ELSE 0 END), 0) as prevu_recettes_cents
       FROM budget_lignes bl
       LEFT JOIN activites a ON a.id = bl.activite_id
       WHERE bl.budget_id = ? AND bl.unite_id IS NOT NULL
       GROUP BY bl.unite_id, bl.activite_id`,
    )
    .all<BudgetPrevuParUniteActivite>(budget.id);

  return { parUnite, parUniteActivite };
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/lib/services/budgets.ts
git commit -m "feat(budgets): agregation getBudgetPrevuParUnite par unite et activite"
```

---

## Task 4 — Route API `/api/budgets/[id]/lignes/[ligneId]`

**Files:**
- Create: `web/src/app/api/budgets/[id]/lignes/[ligneId]/route.ts`

- [ ] **Step 1 : Créer la route**

Crée le dossier puis le fichier. Path à passer entre guillemets pour éviter l'expansion shell :

```bash
mkdir -p "web/src/app/api/budgets/[id]/lignes/[ligneId]"
```

Crée `web/src/app/api/budgets/[id]/lignes/[ligneId]/route.ts` :

```ts
import { z } from 'zod';
import {
  updateBudgetLigne,
  deleteBudgetLigne,
} from '@/lib/services/budgets';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const patchSchema = z.object({
  libelle: z.string().min(1).optional(),
  type: z.enum(['depense', 'recette']).optional(),
  amount_cents: z.number().int().optional(),
  unite_id: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  activite_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; ligneId: string }> },
) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { ligneId } = await params;
  const parsed = await parseJsonBody(request, patchSchema);
  if ('error' in parsed) return parsed.error;
  const updated = await updateBudgetLigne({ groupId: ctxR.ctx.groupId }, ligneId, parsed.data);
  if (!updated) return jsonError('Ligne introuvable', 404);
  return Response.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; ligneId: string }> },
) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { ligneId } = await params;
  const ok = await deleteBudgetLigne({ groupId: ctxR.ctx.groupId }, ligneId);
  if (!ok) return jsonError('Ligne introuvable', 404);
  return new Response(null, { status: 204 });
}
```

Note : `params.id` (budget) n'est pas utilisé fonctionnellement (le service vérifie l'appartenance via ligneId + groupId), mais le segment d'URL reste pour la cohérence REST.

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add "web/src/app/api/budgets/[id]/lignes/[ligneId]/route.ts"
git commit -m "feat(budgets): API PATCH + DELETE sur une ligne budget"
```

---

## Task 5 — Server actions `lib/actions/budgets.ts`

**Files:**
- Create: `web/src/lib/actions/budgets.ts`

- [ ] **Step 1 : Créer le fichier**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentContext } from '../context';
import {
  createBudget,
  createBudgetLigne,
  updateBudgetLigne,
  deleteBudgetLigne,
  updateBudgetStatut,
  listBudgets,
  type BudgetStatut,
} from '../services/budgets';
import { parseAmount } from '../format';

const ADMIN_ROLES = ['tresorier', 'RG'];

async function assertAdmin() {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Accès refusé');
  }
  return ctx;
}

const ensureSchema = z.object({
  saison: z.string().min(9), // 'YYYY-YYYY' minimum
});

// Garantit qu'un budget existe pour la saison ; le crée en 'projet' sinon.
export async function ensureBudgetForSaisonAction(saison: string): Promise<string> {
  ensureSchema.parse({ saison });
  const ctx = await assertAdmin();
  const existing = await listBudgets({ groupId: ctx.groupId }, { saison });
  if (existing.length > 0) return existing[0].id;
  const created = await createBudget({ groupId: ctx.groupId }, { saison });
  return created.id;
}

const createLigneSchema = z.object({
  budget_id: z.string().min(1),
  libelle: z.string().min(1),
  type: z.enum(['depense', 'recette']),
  amount: z.string().min(1), // format français "12,50"
  unite_id: z.string().optional().nullable(),
  category_id: z.string().optional().nullable(),
  activite_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createBudgetLigneAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = createLigneSchema.parse({
    budget_id: formData.get('budget_id'),
    libelle: formData.get('libelle'),
    type: formData.get('type'),
    amount: formData.get('amount'),
    unite_id: formData.get('unite_id') || null,
    category_id: formData.get('category_id') || null,
    activite_id: formData.get('activite_id') || null,
    notes: formData.get('notes') || null,
  });
  await createBudgetLigne(
    { groupId: ctx.groupId },
    {
      budget_id: parsed.budget_id,
      libelle: parsed.libelle,
      type: parsed.type,
      amount_cents: parseAmount(parsed.amount),
      unite_id: parsed.unite_id,
      category_id: parsed.category_id,
      activite_id: parsed.activite_id,
      notes: parsed.notes,
    },
  );
  revalidatePath('/budgets');
}

const updateLigneSchema = z.object({
  ligne_id: z.string().min(1),
  field: z.enum(['libelle', 'type', 'amount', 'unite_id', 'category_id', 'activite_id', 'notes']),
  value: z.string().nullable(),
});

export async function updateBudgetLigneAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = updateLigneSchema.parse({
    ligne_id: formData.get('ligne_id'),
    field: formData.get('field'),
    value: formData.get('value'),
  });
  const v = parsed.value;
  let patch: Parameters<typeof updateBudgetLigne>[2];
  switch (parsed.field) {
    case 'libelle': patch = { libelle: v ?? '' }; break;
    case 'type': patch = { type: (v as 'depense' | 'recette') }; break;
    case 'amount': patch = { amount_cents: v ? parseAmount(v) : 0 }; break;
    case 'unite_id': patch = { unite_id: v || null }; break;
    case 'category_id': patch = { category_id: v || null }; break;
    case 'activite_id': patch = { activite_id: v || null }; break;
    case 'notes': patch = { notes: v || null }; break;
  }
  await updateBudgetLigne({ groupId: ctx.groupId }, parsed.ligne_id, patch);
  revalidatePath('/budgets');
}

const deleteSchema = z.object({ ligne_id: z.string().min(1) });

export async function deleteBudgetLigneAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = deleteSchema.parse({ ligne_id: formData.get('ligne_id') });
  await deleteBudgetLigne({ groupId: ctx.groupId }, parsed.ligne_id);
  revalidatePath('/budgets');
}

const statutSchema = z.object({
  budget_id: z.string().min(1),
  statut: z.enum(['projet', 'vote', 'cloture']),
});

export async function updateBudgetStatutAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = statutSchema.parse({
    budget_id: formData.get('budget_id'),
    statut: formData.get('statut'),
  });
  await updateBudgetStatut({ groupId: ctx.groupId }, parsed.budget_id, parsed.statut as BudgetStatut);
  revalidatePath('/budgets');
}
```

- [ ] **Step 2 : Vérifier que `parseAmount` existe**

Run: `grep -n "export.*parseAmount" web/src/lib/format.ts`
Expected: une ligne `export function parseAmount(...)`.

Si elle n'existe pas (cas peu probable), on stoppe et on signale.

- [ ] **Step 3 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add web/src/lib/actions/budgets.ts
git commit -m "feat(budgets): server actions create/update/delete + ensureBudget + statut"
```

---

## Task 6 — Page `/budgets` (server component shell)

**Files:**
- Create: `web/src/app/(app)/budgets/page.tsx`

- [ ] **Step 1 : Créer la page**

Crée le dossier puis le fichier :

```bash
mkdir -p "web/src/app/(app)/budgets"
```

Crée `web/src/app/(app)/budgets/page.tsx` :

```tsx
import { PageHeader } from '@/components/layout/page-header';
import { TabLink } from '@/components/shared/tab-link';
import { Section } from '@/components/shared/section';
import { listBudgets, listBudgetLignes } from '@/lib/services/budgets';
import { listCategories, listUnites, listActivites } from '@/lib/queries/reference';
import { currentExercice } from '@/lib/services/overview';
import { getCurrentContext } from '@/lib/context';
import { ensureBudgetForSaisonAction } from '@/lib/actions/budgets';
import { BudgetForm } from '@/components/budgets/budget-form';
import { redirect } from 'next/navigation';

interface SearchParams { saison?: string }

function saisonOptions(): { value: string; label: string }[] {
  const cur = currentExercice();
  const curStart = parseInt(cur.split('-')[0], 10);
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = curStart - i;
    opts.push({ value: `${y}-${y + 1}`, label: `Sept ${y} → Août ${y + 1}` });
  }
  return opts;
}

const ADMIN_ROLES = ['tresorier', 'RG'];

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/synthese');
  }
  const sp = await searchParams;
  const saison = sp.saison ?? currentExercice();

  const [budgets, categories, unites, activites] = await Promise.all([
    listBudgets({ groupId: ctx.groupId }, { saison }),
    listCategories(),
    listUnites(),
    listActivites(),
  ]);
  const budget = budgets[0] ?? null;
  const lignesData = budget
    ? await listBudgetLignes({ groupId: ctx.groupId }, budget.id)
    : { lignes: [], total_depenses_cents: 0, total_recettes_cents: 0, solde_cents: 0 };

  const options = saisonOptions();

  return (
    <div>
      <PageHeader
        title="Budget"
        subtitle="Saisie et suivi du budget prévisionnel par saison, unité et activité."
      />

      <div className="mb-4 flex flex-wrap gap-6 border-b">
        {options.map((o) => (
          <TabLink key={o.value} href={`/budgets?saison=${o.value}`} active={saison === o.value}>
            {o.label}
          </TabLink>
        ))}
      </div>

      {!budget ? (
        <Section title={`Saison ${saison}`} className="mb-8">
          <p className="text-sm text-muted-foreground mb-4">
            Pas encore de budget pour cette saison.
          </p>
          <form
            action={async () => {
              'use server';
              await ensureBudgetForSaisonAction(saison);
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-brand text-white px-3 py-1.5 text-sm hover:bg-brand/90"
            >
              Créer le budget {saison}
            </button>
          </form>
        </Section>
      ) : (
        <BudgetForm
          budget={budget}
          lignes={lignesData.lignes}
          totaux={{
            depenses: lignesData.total_depenses_cents,
            recettes: lignesData.total_recettes_cents,
            solde: lignesData.solde_cents,
          }}
          categories={categories}
          unites={unites}
          activites={activites}
          readOnly={budget.statut === 'cloture'}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier que `listActivites` est exporté côté queries**

Run: `grep -n "export.*listActivites" web/src/lib/queries/reference.ts`
Expected: une ligne d'export.

Si absent, ajouter dans `web/src/lib/queries/reference.ts` un wrapper similaire à `listUnites` :

```ts
export async function listActivites(): Promise<Activite[]> {
  const { groupId } = await getCurrentContext();
  return listActivitesService({ groupId });
}
```

(à voir lors de l'impl — adapter selon ce qui existe).

- [ ] **Step 3 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur (le BudgetForm n'existe pas encore, on l'a importé donc ça plantera : on **commit pas encore**, on passe directement à Task 7 qui crée BudgetForm).

⚠️ Note : la vérification tsc peut échouer ici à cause de l'import manquant. **Différer le commit** jusqu'à Task 7 où BudgetForm sera créé.

- [ ] **Step 4 : Pas de commit immédiat**

Ne pas commiter avant Task 7 (sinon main est cassé).

---

## Task 7 — Composant `BudgetForm` (client component)

**Files:**
- Create: `web/src/components/budgets/budget-form.tsx`

- [ ] **Step 1 : Créer le dossier et le fichier**

```bash
mkdir -p web/src/components/budgets
```

Crée `web/src/components/budgets/budget-form.tsx` :

```tsx
'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { StatCard } from '@/components/shared/stat-card';
import { Amount } from '@/components/shared/amount';
import { Section } from '@/components/shared/section';
import { formatAmount } from '@/lib/format';
import {
  createBudgetLigneAction,
  updateBudgetLigneAction,
  deleteBudgetLigneAction,
  updateBudgetStatutAction,
} from '@/lib/actions/budgets';
import type { Budget, BudgetLigne } from '@/lib/services/budgets';
import type { Category, Unite, Activite } from '@/lib/types';

interface Props {
  budget: Budget;
  lignes: BudgetLigne[];
  totaux: { depenses: number; recettes: number; solde: number };
  categories: Category[];
  unites: Unite[];
  activites: Activite[];
  readOnly: boolean;
}

const STATUT_LABELS: Record<Budget['statut'], string> = {
  projet: 'Projet',
  vote: 'Voté',
  cloture: 'Clôturé',
};

export function BudgetForm({
  budget,
  lignes,
  totaux,
  categories,
  unites,
  activites,
  readOnly,
}: Props) {
  const [isPending, startTransition] = useTransition();

  function patchField(ligneId: string, field: string, value: string | null) {
    if (readOnly) return;
    const fd = new FormData();
    fd.set('ligne_id', ligneId);
    fd.set('field', field);
    if (value !== null) fd.set('value', value);
    startTransition(() => updateBudgetLigneAction(fd));
  }

  function deleteLigne(ligneId: string) {
    if (readOnly) return;
    const fd = new FormData();
    fd.set('ligne_id', ligneId);
    startTransition(() => deleteBudgetLigneAction(fd));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm text-muted-foreground">Statut :</span>
        <form action={updateBudgetStatutAction}>
          <input type="hidden" name="budget_id" value={budget.id} />
          <NativeSelect
            name="statut"
            defaultValue={budget.statut}
            onChange={(e) => {
              const f = e.currentTarget.form;
              if (f) startTransition(() => f.requestSubmit());
            }}
          >
            <option value="projet">{STATUT_LABELS.projet}</option>
            <option value="vote">{STATUT_LABELS.vote}</option>
            <option value="cloture">{STATUT_LABELS.cloture}</option>
          </NativeSelect>
        </form>
        {budget.vote_le && (
          <span className="text-xs text-muted-foreground">Voté le {budget.vote_le}</span>
        )}
      </div>

      {readOnly && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Budget clôturé : édition désactivée. Pour ré-éditer, repasse le statut en « Voté » ou « Projet ».
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Prévu dépenses" value={<Amount cents={totaux.depenses} tone="negative" />} />
        <StatCard label="Prévu recettes" value={<Amount cents={totaux.recettes} tone="positive" />} />
        <StatCard label="Prévu solde" value={<Amount cents={totaux.solde} tone="signed" />} />
      </div>

      <Section title={`Lignes (${lignes.length})`} className="mb-8" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Libellé</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Montant</th>
                <th className="px-3 py-2 font-medium">Unité</th>
                <th className="px-3 py-2 font-medium">Catégorie</th>
                <th className="px-3 py-2 font-medium">Activité</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <Input
                      defaultValue={l.libelle}
                      disabled={readOnly}
                      onBlur={(e) => e.currentTarget.value !== l.libelle && patchField(l.id, 'libelle', e.currentTarget.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.type}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'type', e.currentTarget.value)}
                    >
                      <option value="depense">Dépense</option>
                      <option value="recette">Recette</option>
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      defaultValue={formatAmount(l.amount_cents).replace(/\s?€$/, '')}
                      disabled={readOnly}
                      className="text-right tabular-nums"
                      onBlur={(e) => {
                        const raw = e.currentTarget.value.trim();
                        const oldFormatted = formatAmount(l.amount_cents).replace(/\s?€$/, '');
                        if (raw !== oldFormatted) patchField(l.id, 'amount', raw);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.unite_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'unite_id', e.currentTarget.value || null)}
                    >
                      <option value="">—</option>
                      {unites.map((u) => (
                        <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.category_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'category_id', e.currentTarget.value || null)}
                    >
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      defaultValue={l.activite_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => patchField(l.id, 'activite_id', e.currentTarget.value || null)}
                    >
                      <option value="">—</option>
                      {activites.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </NativeSelect>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      defaultValue={l.notes ?? ''}
                      disabled={readOnly}
                      onBlur={(e) => e.currentTarget.value !== (l.notes ?? '') && patchField(l.id, 'notes', e.currentTarget.value || null)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => deleteLigne(l.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <form action={createBudgetLigneAction} className="border-t p-3 grid grid-cols-1 lg:grid-cols-7 gap-2">
            <input type="hidden" name="budget_id" value={budget.id} />
            <Input name="libelle" placeholder="Libellé" required />
            <NativeSelect name="type" defaultValue="depense">
              <option value="depense">Dépense</option>
              <option value="recette">Recette</option>
            </NativeSelect>
            <Input name="amount" placeholder="0,00" className="text-right tabular-nums" required />
            <NativeSelect name="unite_id" defaultValue="">
              <option value="">— unité —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code}</option>
              ))}
            </NativeSelect>
            <NativeSelect name="category_id" defaultValue="">
              <option value="">— catégorie —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect name="activite_id" defaultValue="">
              <option value="">— activité —</option>
              {activites.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </NativeSelect>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand text-white px-3 py-1.5 text-sm hover:bg-brand/90 disabled:opacity-50"
            >
              + Ajouter
            </button>
          </form>
        )}
      </Section>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier types `Category`, `Unite`, `Activite`**

Run: `grep -n "export.*\(Category\|Unite\|Activite\)" web/src/lib/types.ts`
Expected: ces types sont exportés.

- [ ] **Step 3 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur (Task 6 + Task 7 maintenant cohérentes).

- [ ] **Step 4 : Commit (groupé avec Task 6)**

```bash
git add "web/src/app/(app)/budgets/page.tsx" web/src/components/budgets/budget-form.tsx
git commit -m "feat(budgets): page /budgets avec edition inline des lignes"
```

- [ ] **Step 5 : Vérification manuelle**

Lance `cd web && pnpm dev`. Ouvre `http://localhost:3000/budgets`. Vérifie :
- La page charge. Si aucun budget pour la saison, un bouton « Créer le budget ».
- Clic crée le budget, page recharge avec le formulaire vide.
- Ajouter une ligne via le formulaire en bas → apparaît dans la table.
- Modifier un champ (montant, libellé) → persisté au blur.
- Changer le statut → vote_le se met à jour si statut=vote.
- Statut clôturé → tous les inputs disabled, banner ambre visible, bouton ajouter caché.

---

## Task 8 — Ajout item de menu « Budget » dans la sidebar

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx`

- [ ] **Step 1 : Repérer la sidebar**

Run: `grep -n "synthese\|/ecritures" web/src/components/layout/sidebar.tsx | head -10`
Expected: une liste de navigation avec des items pour chaque route principale.

- [ ] **Step 2 : Ajouter l'item « Budget »**

Au niveau où sont définis les items de navigation, ajouter un item pour `/budgets` avec une icône `Calculator` (ou `PiggyBank` ou `FileSpreadsheet`) de lucide-react, visible uniquement pour les rôles `tresorier` / `RG`.

Modèle :
```tsx
{(role === 'tresorier' || role === 'RG') && (
  <NavItem href="/budgets" icon={Calculator} label="Budget" />
)}
```

Adapter selon la structure réelle de `sidebar.tsx` (les patterns de NavItem peuvent différer — suivre l'existant pour les autres items admin-only comme `/synthese` ou `/import`).

- [ ] **Step 3 : Vérification manuelle**

Recharge `http://localhost:3000/`. L'item « Budget » doit apparaître dans la sidebar (desktop) et le menu mobile (si applicable).

- [ ] **Step 4 : Commit**

```bash
git add web/src/components/layout/sidebar.tsx
git commit -m "feat(budgets): item de menu Budget dans la sidebar admin"
```

---

## Task 9 — Synthèse : barre de progression budget sur chaque `UniteCard`

**Files:**
- Modify: `web/src/lib/services/overview.ts`
- Modify: `web/src/components/synthese/unite-card.tsx`
- Modify: `web/src/app/(app)/synthese/page.tsx`

- [ ] **Step 1 : Étendre `parUnite` de `getOverview` avec `budget_prevu_depenses`**

Dans `web/src/lib/services/overview.ts`, modifier le type `OverviewData.parUnite` :

```ts
parUnite: {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
  depenses: number;
  recettes: number;
  solde: number;
  budget_prevu_depenses: number;  // NEW
}[];
```

Et la query `parUnite` (subquery jointe pour récupérer le prévu de la saison correspondant à l'exercice) :

```ts
// Saison correspondant à l'exercice filtré (1:1). Si pas de filtre
// exercice ("Tous"), on passe la saison courante par défaut pour
// que la barre de progression reste cohérente avec ce que le user voit.
const saison = filters.exercice ?? currentExercice();

const parUniteRows = await db.prepare(`
  SELECT u.id, u.code, u.name, u.couleur,
    COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
    COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes,
    COALESCE((
      SELECT SUM(bl.amount_cents) FROM budget_lignes bl
      JOIN budgets b ON b.id = bl.budget_id
      WHERE b.group_id = ? AND b.saison = ?
        AND bl.unite_id = u.id AND bl.type = 'depense'
    ), 0) as budget_prevu_depenses
  FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?${dateClause}
  WHERE u.group_id = ?
  GROUP BY u.id ORDER BY u.code
`).all<{
  id: string; code: string; name: string; couleur: string | null;
  depenses: number; recettes: number; budget_prevu_depenses: number;
}>(groupId, saison, groupId, ...dateValues, groupId);
```

Remplacer le nommage `parUnite` interne par `parUniteRows` pour éviter le shadow et adapter le mapping final.

Et adapter le mapping dans le `return` :

```ts
parUnite: parUniteRows.map(u => ({ ...u, solde: u.recettes - u.depenses })),
```

- [ ] **Step 2 : Étendre `UniteCardData` avec `budget_prevu_depenses`**

Dans `web/src/components/synthese/unite-card.tsx`, modifier l'interface et le rendu :

```ts
export interface UniteCardData {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
  depenses: number;
  recettes: number;
  solde: number;
  budget_prevu_depenses: number;  // NEW
}
```

- [ ] **Step 3 : Ajouter la barre de progression dans `UniteCard`**

Dans le même fichier, avant le bloc `{alertes && …}`, ajouter :

```tsx
{unite.budget_prevu_depenses > 0 && (
  <div className="mt-3 pt-3 border-t">
    <div className="flex justify-between text-xs text-muted-foreground mb-1">
      <span>Budget consommé</span>
      <span className="tabular-nums">
        <Amount cents={unite.depenses} /> / <Amount cents={unite.budget_prevu_depenses} />
      </span>
    </div>
    <div className="h-1.5 rounded bg-muted overflow-hidden">
      <div
        className="h-full transition-all"
        style={{
          width: `${Math.min(100, Math.round((unite.depenses / unite.budget_prevu_depenses) * 100))}%`,
          backgroundColor: unite.depenses > unite.budget_prevu_depenses ? '#dc2626' : couleur,
        }}
      />
    </div>
  </div>
)}
```

(`couleur` est déjà résolu plus haut dans le composant via `unite.couleur ?? '#C9C9C9'`.)

- [ ] **Step 4 : Passer le champ depuis `synthese/page.tsx`**

Modifier le mapping vers `UnitesGrid` pour inclure `budget_prevu_depenses` :

```tsx
<UnitesGrid
  unites={data.parUnite.map((u) => ({
    id: u.id,
    code: u.code,
    name: u.name,
    couleur: u.couleur,
    depenses: u.depenses,
    recettes: u.recettes,
    solde: u.solde,
    budget_prevu_depenses: u.budget_prevu_depenses,
  }))}
  exerciceParam={exerciceParam}
/>
```

- [ ] **Step 5 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Vérification manuelle**

Recharge `http://localhost:3000/synthese`. Pour les unités où tu as saisi des lignes budget : la card affiche une barre de progression avec les bons montants. Pour celles sans budget : pas de barre (la section est masquée via `unite.budget_prevu_depenses > 0`).

- [ ] **Step 7 : Commit**

```bash
git add web/src/lib/services/overview.ts web/src/components/synthese/unite-card.tsx "web/src/app/(app)/synthese/page.tsx"
git commit -m "feat(synthese): barre de progression budget consomme sur UniteCard"
```

---

## Task 10 — Détail unité : colonne « Budget » + bloc « Par activité »

**Files:**
- Modify: `web/src/lib/services/overview.ts` (extension `UniteOverviewData` + query)
- Modify: `web/src/app/(app)/synthese/unite/[id]/page.tsx`

- [ ] **Step 1 : Étendre `UniteOverviewData` avec données budget**

Dans `web/src/lib/services/overview.ts`, modifier le type :

```ts
export interface CategorieRow {
  category_id: string | null;
  category_name: string;
  comptaweb_id: number | null;
  depenses: number;
  recettes: number;
  budget_prevu_depenses: number;  // NEW
  budget_prevu_recettes: number;  // NEW
}

export interface ParActiviteRow {
  activite_id: string | null;
  activite_name: string | null;
  reel_depenses: number;
  reel_recettes: number;
  prevu_depenses: number;
  prevu_recettes: number;
}

export interface UniteOverviewData {
  // …champs existants…
  parActivite: ParActiviteRow[];  // NEW
}
```

- [ ] **Step 2 : Étendre la query `parCategorie` pour inclure les budgets**

Dans `getUniteOverview`, modifier la query :

```ts
const saison = filters.exercice ?? currentExercice();

const parCategorie = await db.prepare(`
  SELECT
    c.id as category_id,
    COALESCE(c.name, '(non catégorisé)') as category_name,
    c.comptaweb_id,
    COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
    COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes,
    COALESCE((
      SELECT SUM(bl.amount_cents) FROM budget_lignes bl
      JOIN budgets b ON b.id = bl.budget_id
      WHERE b.group_id = ? AND b.saison = ?
        AND bl.unite_id = ? AND bl.type = 'depense'
        AND (bl.category_id IS NOT DISTINCT FROM c.id)
    ), 0) as budget_prevu_depenses,
    COALESCE((
      SELECT SUM(bl.amount_cents) FROM budget_lignes bl
      JOIN budgets b ON b.id = bl.budget_id
      WHERE b.group_id = ? AND b.saison = ?
        AND bl.unite_id = ? AND bl.type = 'recette'
        AND (bl.category_id IS NOT DISTINCT FROM c.id)
    ), 0) as budget_prevu_recettes
  FROM ecritures e
  LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
  GROUP BY c.id
  ORDER BY (depenses + recettes) DESC
`).all<CategorieRow>(
  groupId, saison, args.uniteId,
  groupId, saison, args.uniteId,
  groupId, args.uniteId, ...dateValues,
);
```

⚠️ `IS NOT DISTINCT FROM` n'est pas supporté en SQLite < 3.39 et libsql peut être plus ancien. Fallback compatible (NULL-safe equality manuelle) :

```sql
AND ((bl.category_id IS NULL AND c.id IS NULL) OR bl.category_id = c.id)
```

Utiliser cette forme à la place.

- [ ] **Step 3 : Ajouter la query `parActivite`**

Après la query `parCategorie`, avant le `return` :

```ts
const parActivite = await db.prepare(`
  WITH reel AS (
    SELECT e.activite_id,
           SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END) as reel_depenses,
           SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END) as reel_recettes
    FROM ecritures e
    WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
    GROUP BY e.activite_id
  ),
  prevu AS (
    SELECT bl.activite_id,
           SUM(CASE WHEN bl.type = 'depense' THEN bl.amount_cents ELSE 0 END) as prevu_depenses,
           SUM(CASE WHEN bl.type = 'recette' THEN bl.amount_cents ELSE 0 END) as prevu_recettes
    FROM budget_lignes bl
    JOIN budgets b ON b.id = bl.budget_id
    WHERE b.group_id = ? AND b.saison = ? AND bl.unite_id = ?
    GROUP BY bl.activite_id
  ),
  union_ids AS (
    SELECT activite_id FROM reel
    UNION
    SELECT activite_id FROM prevu
  )
  SELECT u.activite_id, a.name as activite_name,
         COALESCE(r.reel_depenses, 0) as reel_depenses,
         COALESCE(r.reel_recettes, 0) as reel_recettes,
         COALESCE(p.prevu_depenses, 0) as prevu_depenses,
         COALESCE(p.prevu_recettes, 0) as prevu_recettes
  FROM union_ids u
  LEFT JOIN activites a ON a.id = u.activite_id
  LEFT JOIN reel r ON r.activite_id IS u.activite_id
  LEFT JOIN prevu p ON p.activite_id IS u.activite_id
  ORDER BY p.prevu_depenses DESC NULLS LAST, r.reel_depenses DESC NULLS LAST
`).all<ParActiviteRow>(
  groupId, args.uniteId, ...dateValues,
  groupId, saison, args.uniteId,
);
```

⚠️ `IS` pour NULL-safe equality fonctionne en SQLite. Si la sortie ordering avec `NULLS LAST` n'est pas supportée, retirer le suffixe et trier en JS après le `.all()`.

Inclure `parActivite` dans le `return` final.

- [ ] **Step 4 : Modifier la page détail pour afficher la colonne Budget**

Dans `web/src/app/(app)/synthese/unite/[id]/page.tsx`, la table « Par catégorie » :

- Ajouter une colonne `<TableHead className="text-right">Budget</TableHead>` après « Recettes »
- Pour chaque ligne, afficher :

```tsx
<TableCell className="text-right tabular-nums">
  {c.budget_prevu_depenses + c.budget_prevu_recettes > 0 ? (
    <span className="text-xs text-muted-foreground">
      <Amount cents={c.budget_prevu_depenses + c.budget_prevu_recettes} />
    </span>
  ) : (
    <span className="text-fg-subtle">—</span>
  )}
</TableCell>
```

- [ ] **Step 5 : Ajouter le bloc « Par activité » sur la page détail**

Toujours dans `web/src/app/(app)/synthese/unite/[id]/page.tsx`, avant la Section « Écritures récentes », ajouter :

```tsx
<Section
  title="Par activité"
  subtitle="Comparaison prévu (budget) et réel par activité pour cette unité. La dualité activités d'année vs camps se lit dans le nom des activités."
  className="mb-8"
  bodyClassName="px-0 pb-0"
>
  {data.parActivite.length === 0 ? (
    <p className="px-5 py-4 text-sm text-muted-foreground">
      Aucune activité avec budget ou réel sur la période.
    </p>
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Activité</TableHead>
          <TableHead className="text-right">Prévu dép.</TableHead>
          <TableHead className="text-right">Réel dép.</TableHead>
          <TableHead className="text-right">Prévu rec.</TableHead>
          <TableHead className="text-right">Réel rec.</TableHead>
          <TableHead className="text-right">Écart dép.</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.parActivite.map((a) => {
          const ecartDep = a.reel_depenses - a.prevu_depenses;
          return (
            <TableRow key={a.activite_id ?? '__none__'}>
              <TableCell className="font-medium">
                {a.activite_name ?? <span className="text-muted-foreground">— sans activité —</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {a.prevu_depenses > 0 ? <Amount cents={a.prevu_depenses} /> : <span className="text-fg-subtle">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {a.reel_depenses > 0 ? <Amount cents={a.reel_depenses} tone="negative" /> : <span className="text-fg-subtle">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {a.prevu_recettes > 0 ? <Amount cents={a.prevu_recettes} /> : <span className="text-fg-subtle">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {a.reel_recettes > 0 ? <Amount cents={a.reel_recettes} tone="positive" /> : <span className="text-fg-subtle">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {a.prevu_depenses > 0 ? <Amount cents={ecartDep} tone="signed" /> : <span className="text-fg-subtle">—</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  )}
</Section>
```

- [ ] **Step 6 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7 : Vérification manuelle**

Avec quelques lignes budget saisies pour une unité, ouvre `/synthese/unite/<id>` :
- La table « Par catégorie » a une nouvelle colonne « Budget » à droite.
- Un bloc « Par activité » apparaît avec prévu vs réel par activité.
- Les valeurs sont cohérentes avec ce qui a été saisi sur `/budgets`.

- [ ] **Step 8 : Commit**

```bash
git add web/src/lib/services/overview.ts "web/src/app/(app)/synthese/unite/[id]/page.tsx"
git commit -m "feat(synthese): colonne Budget + bloc Par activite sur detail unite"
```

---

## Task 11 — Build prod + smoke test final

- [ ] **Step 1 : Build production**

```bash
cd web && pnpm build
```

Expected: build OK, aucune erreur TS, route `/budgets` et `/api/budgets/[id]/lignes/[ligneId]` listées (les deux comme `ƒ Dynamic`).

Si une route plante avec « Dynamic server usage », ajouter `export const dynamic = 'force-dynamic';` au top du fichier concerné.

- [ ] **Step 2 : Vitest**

```bash
pnpm exec vitest run
```

Expected: tous les tests existants passent (aucun n'est censé être impacté par ces changements).

- [ ] **Step 3 : Smoke test fonctionnel complet**

Avec le dev server qui tourne :

1. Aller sur `/budgets` (lien sidebar) → page charge, saison courante par défaut.
2. Si pas de budget : « Créer le budget » → crée.
3. Ajouter 2-3 lignes (dépense LJ catégorie X montant 100€, dépense LJ activité « Camp été » 500€, recette SG 50€).
4. Modifier un montant inline → persisté.
5. Supprimer une ligne → disparaît.
6. Changer statut en `vote` → `vote_le` se met à jour.
7. Changer statut en `cloture` → édition désactivée, banner ambre.
8. Re-passer en `vote` → édition revient.
9. Aller sur `/synthese` → les cards des unités avec budget montrent une barre de progression.
10. Cliquer sur la card LJ → page détail : colonne Budget remplie, bloc « Par activité » affiche les bonnes lignes.
11. Tester `/budgets?saison=2023-2024` (saison sans budget) → bouton « Créer le budget ».

- [ ] **Step 4 : Pas de push automatique**

Conformément à la convention projet : ne pas pousser sur la remote. Demander explicitement au user avant tout `git push`.

---

## Self-review — couverture spec

- ✅ Modèle BDD : `budget_lignes.activite_id` ajouté (Task 1)
- ✅ 1 budget par saison conservé (pas de migration des budgets eux-mêmes)
- ✅ Backend `updateBudgetLigne` (Task 2)
- ✅ Backend `deleteBudgetLigne` (Task 2)
- ✅ Backend `getBudgetPrevuParUnite` (Task 3)
- ✅ API REST PATCH + DELETE (Task 4)
- ✅ Server actions (Task 5)
- ✅ Page `/budgets` avec saisie inline (Tasks 6, 7)
- ✅ Sélecteur saison + statut éditable (Tasks 6, 7)
- ✅ Lecture seule si `cloture` (Task 7)
- ✅ Lien menu sidebar (Task 8)
- ✅ Barre de progression sur `UniteCard` (Task 9)
- ✅ Colonne « Budget » + bloc « Par activité » sur détail unité (Task 10)
- ✅ Pas de dimension « periode » — dérivée des activités
- ✅ Caisse hors scope (cohérent avec spec, aucune action requise)
- ✅ Anti-énumération inter-groupes sur toutes les nouvelles fonctions
- ✅ Pas de tests unitaires (cohérent pattern projet)
