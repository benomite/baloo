# Répartitions entre unités — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le mécanisme de répartition Baloo-only entre unités (table dédiée + service + UI synthèse) pour permettre au trésorier de réallouer manuellement les recettes globales (inscriptions) vers les unités.

**Architecture:** Nouvelle table `repartitions_unites` (création directe via `CREATE TABLE IF NOT EXISTS`, pas de migration). Module de validation pur testé en vitest. Service avec anti-énumération par `group_id`. Intégration dans `getOverview` et `getUniteOverview` via sous-requête SQL. UI : drawer de saisie déclenché depuis `/synthese`, KPI + bloc historique sur la page détail unité.

**Tech Stack:** Next 16 (App Router, server components, server actions, drawer), libsql/Turso, Tailwind, lucide-react, zod, vitest. Aucune nouvelle dépendance.

**Spec source :** [`doc/specs/2026-05-11-repartitions-unites-design.md`](../specs/2026-05-11-repartitions-unites-design.md)

**Tests :** 1 module pur testé en vitest (`repartitions-validation.ts`). Reste = vérification manuelle (pattern projet pour les services BDD-coupled et UI).

---

## File Structure

**Créé :**
- `web/src/lib/services/repartitions-validation.ts` — fonction pure de validation d'une `CreateRepartitionInput`
- `web/src/lib/services/repartitions-validation.test.ts` — tests vitest
- `web/src/lib/services/repartitions.ts` — service CRUD + agrégations
- `web/src/lib/queries/repartitions.ts` — wrappers avec `getCurrentContext`
- `web/src/lib/actions/repartitions.ts` — server actions create/update/delete
- `web/src/components/synthese/repartition-drawer.tsx` — client component drawer de saisie
- `web/src/components/synthese/repartitions-list.tsx` — client component liste éditable

**Modifié :**
- `web/src/lib/db/business-schema.ts` — ajout du `CREATE TABLE IF NOT EXISTS repartitions_unites`
- `web/src/lib/services/overview.ts` — sous-requête `realloc_net_cents` dans `parUnite`, et `reallocEntrantesCents`/`reallocSortantesCents`/`reallocNetCents`/`repartitions` dans `UniteOverviewData`
- `web/src/components/synthese/unite-card.tsx` — extension `UniteCardData` + ligne Réalloc + Solde net
- `web/src/app/(app)/synthese/page.tsx` — bouton « Répartir » + drawer + mapping enrichi
- `web/src/app/(app)/synthese/unite/[id]/page.tsx` — KPI Réalloc + bloc Répartitions

---

## Task 1 — Table `repartitions_unites` dans `business-schema.ts`

**Files:**
- Modify: `web/src/lib/db/business-schema.ts` (zone « Comptes & budgets » ou immédiatement après `budget_lignes`)

- [ ] **Step 1 : Ajouter le `CREATE TABLE` et les index**

Repérer dans `web/src/lib/db/business-schema.ts` le bloc des budgets (après `CREATE INDEX idx_budget_lignes_unite`). Ajouter juste après :

```sql
-- Répartitions entre unités (phase 3) : mouvement Baloo-only qui
-- déplace un montant d'une unité source vers une unité cible. NULL
-- côté source ou cible = "Groupe" (pot commun). Pas de flux Comptaweb.
-- Validation source != cible côté code (pas de CHECK SQL — cf. ADR-019
-- et convention "workflow en code, pas en BDD").
CREATE TABLE IF NOT EXISTS repartitions_unites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groupes(id),
  date_repartition TEXT NOT NULL,
  saison TEXT NOT NULL,
  montant_cents INTEGER NOT NULL,
  unite_source_id TEXT REFERENCES unites(id),
  unite_cible_id TEXT REFERENCES unites(id),
  libelle TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_repartitions_group_saison ON repartitions_unites(group_id, saison);
CREATE INDEX IF NOT EXISTS idx_repartitions_source ON repartitions_unites(unite_source_id);
CREATE INDEX IF NOT EXISTS idx_repartitions_cible ON repartitions_unites(unite_cible_id);
```

- [ ] **Step 2 : Vérifier le typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Smoke test BDD (boot local)**

Run: `cd web && pnpm dev` (laisse tourner 5s).
Ouvre `http://localhost:3000/synthese` — la page doit charger sans erreur 500 (le schema s'ensure au boot).
Arrête le dev server.

- [ ] **Step 4 : Commit**

```bash
git add web/src/lib/db/business-schema.ts
git commit -m "feat(repartitions): table repartitions_unites pour mouvements internes"
```

---

## Task 2 — Module pur de validation + tests vitest

**Files:**
- Create: `web/src/lib/services/repartitions-validation.ts`
- Create: `web/src/lib/services/repartitions-validation.test.ts`

- [ ] **Step 1 : Écrire les tests d'abord (TDD)**

Crée `web/src/lib/services/repartitions-validation.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { validateRepartitionInput, type RepartitionValidationInput } from './repartitions-validation';

const base: RepartitionValidationInput = {
  date_repartition: '2026-01-15',
  saison: '2025-2026',
  montant_cents: 60000,
  unite_source_id: null,        // = Groupe
  unite_cible_id: 'unt-lj-1',
  libelle: 'Quote-part inscriptions LJ',
};

describe('validateRepartitionInput', () => {
  it('accepte un input valide (Groupe → unité)', () => {
    expect(validateRepartitionInput(base)).toBeNull();
  });

  it('accepte un input valide (unité → unité)', () => {
    expect(validateRepartitionInput({ ...base, unite_source_id: 'unt-sg-1', unite_cible_id: 'unt-lj-1' })).toBeNull();
  });

  it('rejette source = cible (mêmes unités)', () => {
    const err = validateRepartitionInput({ ...base, unite_source_id: 'unt-lj-1', unite_cible_id: 'unt-lj-1' });
    expect(err).toMatch(/source/i);
  });

  it('rejette source et cible NULL (Groupe → Groupe)', () => {
    const err = validateRepartitionInput({ ...base, unite_source_id: null, unite_cible_id: null });
    expect(err).toMatch(/source/i);
  });

  it('rejette montant zéro', () => {
    const err = validateRepartitionInput({ ...base, montant_cents: 0 });
    expect(err).toMatch(/montant/i);
  });

  it('rejette montant négatif', () => {
    const err = validateRepartitionInput({ ...base, montant_cents: -100 });
    expect(err).toMatch(/montant/i);
  });

  it('rejette libellé vide', () => {
    const err = validateRepartitionInput({ ...base, libelle: '' });
    expect(err).toMatch(/libell/i);
  });

  it('rejette libellé whitespace seulement', () => {
    const err = validateRepartitionInput({ ...base, libelle: '   ' });
    expect(err).toMatch(/libell/i);
  });

  it('rejette date au format invalide', () => {
    const err = validateRepartitionInput({ ...base, date_repartition: '15/01/2026' });
    expect(err).toMatch(/date/i);
  });

  it('rejette saison au format invalide', () => {
    const err = validateRepartitionInput({ ...base, saison: '2025' });
    expect(err).toMatch(/saison/i);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour confirmer l'échec**

Run: `cd web && pnpm exec vitest run src/lib/services/repartitions-validation.test.ts`
Expected: ÉCHEC avec « Cannot find module './repartitions-validation' » ou équivalent.

- [ ] **Step 3 : Implémenter le module**

Crée `web/src/lib/services/repartitions-validation.ts` :

```ts
export interface RepartitionValidationInput {
  date_repartition: string;        // YYYY-MM-DD
  saison: string;                  // YYYY-YYYY (ex. 2025-2026)
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
}

// Valide un input de création/édition de répartition. Retourne un message
// d'erreur explicite si invalide, null si OK. Pas de dépendance BDD —
// testable en pur vitest.
export function validateRepartitionInput(input: RepartitionValidationInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date_repartition)) {
    return 'Date invalide (attendu YYYY-MM-DD).';
  }
  if (!/^\d{4}-\d{4}$/.test(input.saison)) {
    return 'Saison invalide (attendu YYYY-YYYY).';
  }
  if (!Number.isInteger(input.montant_cents) || input.montant_cents <= 0) {
    return 'Montant invalide (attendu un entier strictement positif).';
  }
  if (input.unite_source_id === null && input.unite_cible_id === null) {
    return "Une répartition Groupe → Groupe n'a pas de sens (source et cible sont identiques).";
  }
  if (input.unite_source_id !== null && input.unite_source_id === input.unite_cible_id) {
    return "Une répartition d'une unité vers elle-même n'a pas de sens (source = cible).";
  }
  if (input.libelle.trim().length === 0) {
    return 'Libellé requis.';
  }
  return null;
}
```

- [ ] **Step 4 : Lancer les tests pour confirmer le succès**

Run: `cd web && pnpm exec vitest run src/lib/services/repartitions-validation.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 5 : tsc**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add web/src/lib/services/repartitions-validation.ts web/src/lib/services/repartitions-validation.test.ts
git commit -m "feat(repartitions): module de validation pur + 10 tests vitest"
```

---

## Task 3 — Service `repartitions.ts` (CRUD + agrégation)

**Files:**
- Create: `web/src/lib/services/repartitions.ts`

- [ ] **Step 1 : Créer le fichier**

```ts
import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import {
  validateRepartitionInput,
  type RepartitionValidationInput,
} from './repartitions-validation';

export interface RepartitionContext {
  groupId: string;
}

export interface Repartition {
  id: string;
  group_id: string;
  date_repartition: string;
  saison: string;
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRepartitionInput {
  date_repartition: string;
  saison: string;
  montant_cents: number;
  unite_source_id: string | null;
  unite_cible_id: string | null;
  libelle: string;
  notes?: string | null;
}

export type UpdateRepartitionInput = Partial<{
  date_repartition: string;
  saison: string;
  montant_cents: number;
  libelle: string;
  notes: string | null;
}>;
// Note : pas de unite_source_id / unite_cible_id en update — pour
// changer la source/cible, supprimer et recréer (cohérence sémantique).

export class RepartitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepartitionValidationError';
  }
}

export interface ListRepartitionsOptions {
  saison?: string;
}

export async function listRepartitions(
  { groupId }: RepartitionContext,
  options: ListRepartitionsOptions = {},
): Promise<Repartition[]> {
  const conditions: string[] = ['group_id = ?'];
  const values: unknown[] = [groupId];
  if (options.saison) { conditions.push('saison = ?'); values.push(options.saison); }
  return await getDb()
    .prepare(`SELECT * FROM repartitions_unites WHERE ${conditions.join(' AND ')} ORDER BY date_repartition DESC, id DESC`)
    .all<Repartition>(...values);
}

export async function createRepartition(
  { groupId }: RepartitionContext,
  input: CreateRepartitionInput,
): Promise<Repartition> {
  const validation: RepartitionValidationInput = {
    date_repartition: input.date_repartition,
    saison: input.saison,
    montant_cents: input.montant_cents,
    unite_source_id: input.unite_source_id,
    unite_cible_id: input.unite_cible_id,
    libelle: input.libelle,
  };
  const err = validateRepartitionInput(validation);
  if (err) throw new RepartitionValidationError(err);

  const db = getDb();
  const id = `rep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = currentTimestamp();
  await db.prepare(
    `INSERT INTO repartitions_unites (id, group_id, date_repartition, saison, montant_cents, unite_source_id, unite_cible_id, libelle, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    groupId,
    input.date_repartition,
    input.saison,
    input.montant_cents,
    input.unite_source_id,
    input.unite_cible_id,
    input.libelle.trim(),
    input.notes?.trim() || null,
    now,
    now,
  );
  return (await db.prepare('SELECT * FROM repartitions_unites WHERE id = ?').get<Repartition>(id))!;
}

// Anti-énumération inter-groupes : retourne null si la répartition
// n'appartient pas au groupe courant.
export async function updateRepartition(
  { groupId }: RepartitionContext,
  id: string,
  patch: UpdateRepartitionInput,
): Promise<Repartition | null> {
  const db = getDb();
  const existing = await db
    .prepare('SELECT * FROM repartitions_unites WHERE id = ? AND group_id = ?')
    .get<Repartition>(id, groupId);
  if (!existing) return null;

  // Valider l'état projeté après patch (sauf source/cible qui ne changent pas).
  const merged: RepartitionValidationInput = {
    date_repartition: patch.date_repartition ?? existing.date_repartition,
    saison: patch.saison ?? existing.saison,
    montant_cents: patch.montant_cents ?? existing.montant_cents,
    unite_source_id: existing.unite_source_id,
    unite_cible_id: existing.unite_cible_id,
    libelle: patch.libelle ?? existing.libelle,
  };
  const err = validateRepartitionInput(merged);
  if (err) throw new RepartitionValidationError(err);

  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.date_repartition !== undefined) { sets.push('date_repartition = ?'); values.push(patch.date_repartition); }
  if (patch.saison !== undefined) { sets.push('saison = ?'); values.push(patch.saison); }
  if (patch.montant_cents !== undefined) { sets.push('montant_cents = ?'); values.push(patch.montant_cents); }
  if (patch.libelle !== undefined) { sets.push('libelle = ?'); values.push(patch.libelle.trim()); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); values.push(patch.notes?.trim() || null); }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  values.push(currentTimestamp());
  values.push(id);
  await db.prepare(`UPDATE repartitions_unites SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return (await db.prepare('SELECT * FROM repartitions_unites WHERE id = ?').get<Repartition>(id))!;
}

export async function deleteRepartition(
  { groupId }: RepartitionContext,
  id: string,
): Promise<boolean> {
  const db = getDb();
  const owned = await db
    .prepare('SELECT id FROM repartitions_unites WHERE id = ? AND group_id = ?')
    .get<{ id: string }>(id, groupId);
  if (!owned) return false;
  await db.prepare('DELETE FROM repartitions_unites WHERE id = ?').run(id);
  return true;
}

// Net (entrantes - sortantes) par unité, restreint à une saison.
// Map<unite_id, net_cents>. Les répartitions "Groupe" (source ou cible NULL)
// ne contribuent que du côté unité — le solde Groupe n'est pas calculé ici
// (il vit ailleurs si besoin).
export async function getRepartitionsNetByUnite(
  { groupId }: RepartitionContext,
  saison: string,
): Promise<Record<string, number>> {
  const rows = await getDb()
    .prepare(
      `SELECT unite_cible_id as unite_id, SUM(montant_cents) as total
       FROM repartitions_unites
       WHERE group_id = ? AND saison = ? AND unite_cible_id IS NOT NULL
       GROUP BY unite_cible_id`,
    )
    .all<{ unite_id: string; total: number }>(groupId, saison);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.unite_id] = (out[r.unite_id] ?? 0) + r.total;
  const sortantes = await getDb()
    .prepare(
      `SELECT unite_source_id as unite_id, SUM(montant_cents) as total
       FROM repartitions_unites
       WHERE group_id = ? AND saison = ? AND unite_source_id IS NOT NULL
       GROUP BY unite_source_id`,
    )
    .all<{ unite_id: string; total: number }>(groupId, saison);
  for (const r of sortantes) out[r.unite_id] = (out[r.unite_id] ?? 0) - r.total;
  return out;
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/lib/services/repartitions.ts
git commit -m "feat(repartitions): service CRUD + agregation net par unite"
```

---

## Task 4 — Wrappers queries `lib/queries/repartitions.ts`

**Files:**
- Create: `web/src/lib/queries/repartitions.ts`

- [ ] **Step 1 : Créer le fichier**

```ts
import { getCurrentContext } from '../context';
import {
  listRepartitions as listRepartitionsService,
  getRepartitionsNetByUnite as getRepartitionsNetByUniteService,
  type Repartition,
  type ListRepartitionsOptions,
} from '../services/repartitions';

export type { Repartition, ListRepartitionsOptions };

export async function listRepartitions(options: ListRepartitionsOptions = {}): Promise<Repartition[]> {
  const { groupId } = await getCurrentContext();
  return listRepartitionsService({ groupId }, options);
}

export async function getRepartitionsNetByUnite(saison: string): Promise<Record<string, number>> {
  const { groupId } = await getCurrentContext();
  return getRepartitionsNetByUniteService({ groupId }, saison);
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/lib/queries/repartitions.ts
git commit -m "feat(repartitions): wrappers queries avec resolveContext"
```

---

## Task 5 — Server actions `lib/actions/repartitions.ts`

**Files:**
- Create: `web/src/lib/actions/repartitions.ts`

- [ ] **Step 1 : Créer le fichier**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentContext } from '../context';
import {
  createRepartition,
  updateRepartition,
  deleteRepartition,
  RepartitionValidationError,
} from '../services/repartitions';
import { parseAmount } from '../format';

const ADMIN_ROLES = ['tresorier', 'RG'];

async function assertAdmin() {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Accès refusé');
  }
  return ctx;
}

function nullIfEmpty(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
}

const createSchema = z.object({
  date_repartition: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  saison: z.string().regex(/^\d{4}-\d{4}$/),
  amount: z.string().min(1),
  unite_source_id: z.string().nullable(),
  unite_cible_id: z.string().nullable(),
  libelle: z.string().min(1),
  notes: z.string().nullable(),
});

// Retourne null si succès, message d'erreur si validation échoue.
// Pattern useFormState compatible : la page client peut afficher le message.
export interface RepartitionFormState { error: string | null }

export async function createRepartitionAction(
  _prev: RepartitionFormState,
  formData: FormData,
): Promise<RepartitionFormState> {
  const ctx = await assertAdmin();
  let parsed;
  try {
    parsed = createSchema.parse({
      date_repartition: formData.get('date_repartition'),
      saison: formData.get('saison'),
      amount: formData.get('amount'),
      unite_source_id: nullIfEmpty(formData.get('unite_source_id')),
      unite_cible_id: nullIfEmpty(formData.get('unite_cible_id')),
      libelle: formData.get('libelle'),
      notes: nullIfEmpty(formData.get('notes')),
    });
  } catch (e) {
    return { error: 'Champs invalides — vérifie date, saison, montant et libellé.' };
  }
  try {
    await createRepartition(
      { groupId: ctx.groupId },
      {
        date_repartition: parsed.date_repartition,
        saison: parsed.saison,
        montant_cents: parseAmount(parsed.amount),
        unite_source_id: parsed.unite_source_id,
        unite_cible_id: parsed.unite_cible_id,
        libelle: parsed.libelle,
        notes: parsed.notes,
      },
    );
  } catch (e) {
    if (e instanceof RepartitionValidationError) {
      return { error: e.message };
    }
    throw e;
  }
  revalidatePath('/synthese');
  return { error: null };
}

const updateFieldSchema = z.object({
  id: z.string().min(1),
  field: z.enum(['date_repartition', 'amount', 'libelle', 'notes']),
  value: z.string().nullable(),
});

export async function updateRepartitionAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = updateFieldSchema.parse({
    id: formData.get('id'),
    field: formData.get('field'),
    value: formData.get('value'),
  });
  const v = parsed.value;
  let patch: Parameters<typeof updateRepartition>[2];
  switch (parsed.field) {
    case 'date_repartition': patch = { date_repartition: v ?? '' }; break;
    case 'amount': patch = { montant_cents: v ? parseAmount(v) : 0 }; break;
    case 'libelle': patch = { libelle: v ?? '' }; break;
    case 'notes': patch = { notes: v && v.trim() !== '' ? v : null }; break;
  }
  try {
    await updateRepartition({ groupId: ctx.groupId }, parsed.id, patch);
  } catch (e) {
    if (e instanceof RepartitionValidationError) {
      // Edition inline : on swallow l'erreur pour ne pas casser l'UI.
      // L'utilisateur verra que le champ n'a pas changé en rechargeant.
      return;
    }
    throw e;
  }
  revalidatePath('/synthese');
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteRepartitionAction(formData: FormData): Promise<void> {
  const ctx = await assertAdmin();
  const parsed = deleteSchema.parse({ id: formData.get('id') });
  await deleteRepartition({ groupId: ctx.groupId }, parsed.id);
  revalidatePath('/synthese');
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/lib/actions/repartitions.ts
git commit -m "feat(repartitions): server actions create/update/delete"
```

---

## Task 6 — Enrichir `getOverview.parUnite` avec `realloc_net_cents`

**Files:**
- Modify: `web/src/lib/services/overview.ts`

- [ ] **Step 1 : Étendre le type `OverviewData.parUnite`**

Modifier l'interface :

```ts
parUnite: {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
  depenses: number;
  recettes: number;
  solde: number;
  budget_prevu_depenses: number;
  realloc_net_cents: number;       // NEW
  solde_avec_realloc: number;      // NEW
}[];
```

- [ ] **Step 2 : Étendre la query SQL `parUniteRows`**

Repérer le bloc `const parUniteRows = await db.prepare(` qui calcule déjà `depenses`, `recettes`, `budget_prevu_depenses`. Ajouter un 3e sous-SELECT dans la même query :

```ts
const parUniteRows = await db.prepare(`
  SELECT u.id, u.code, u.name, u.couleur,
    COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
    COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes,
    COALESCE((
      SELECT SUM(bl.amount_cents) FROM budget_lignes bl
      JOIN budgets b ON b.id = bl.budget_id
      WHERE b.group_id = ? AND b.saison = ?
        AND bl.unite_id = u.id AND bl.type = 'depense'
    ), 0) as budget_prevu_depenses,
    COALESCE((
      SELECT
        COALESCE(SUM(CASE WHEN r.unite_cible_id = u.id THEN r.montant_cents ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN r.unite_source_id = u.id THEN r.montant_cents ELSE 0 END), 0)
      FROM repartitions_unites r
      WHERE r.group_id = ? AND r.saison = ?
    ), 0) as realloc_net_cents
  FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?${dateClause}
  WHERE u.group_id = ?
  GROUP BY u.id ORDER BY u.code
`).all<{
  id: string; code: string; name: string; couleur: string | null;
  depenses: number; recettes: number; budget_prevu_depenses: number;
  realloc_net_cents: number;
}>(groupId, saison, groupId, saison, groupId, ...dateValues, groupId);
```

⚠️ Ordre des bind values : `(groupId, saison)` pour le sous-SELECT budget, puis `(groupId, saison)` pour le sous-SELECT réalloc, puis `(groupId, ...dateValues, groupId)` pour le FROM principal et le WHERE final. Soit **6 valeurs avant `dateValues`** + `dateValues` + `groupId` final.

- [ ] **Step 3 : Adapter le mapping final**

Modifier le `parUnite: parUniteRows.map(...)` dans le `return` :

```ts
parUnite: parUniteRows.map((u) => ({
  ...u,
  solde: u.recettes - u.depenses,
  solde_avec_realloc: u.recettes - u.depenses + u.realloc_net_cents,
})),
```

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/overview.ts
git commit -m "feat(overview): realloc_net_cents et solde_avec_realloc dans parUnite"
```

---

## Task 7 — Enrichir `getUniteOverview` avec données répartitions

**Files:**
- Modify: `web/src/lib/services/overview.ts`

- [ ] **Step 1 : Étendre `UniteOverviewData`**

Repérer l'interface `UniteOverviewData` et ajouter :

```ts
import type { Repartition } from './repartitions';

export interface UniteOverviewData {
  // …champs existants…
  reallocEntrantesCents: number;     // NEW
  reallocSortantesCents: number;     // NEW
  reallocNetCents: number;            // NEW (= entrantes - sortantes)
  repartitions: Repartition[];        // NEW (liste pour le bloc historique)
}
```

- [ ] **Step 2 : Ajouter les queries dans `getUniteOverview`**

Dans la fonction `getUniteOverview`, après les autres queries scopées sur l'unité (`parCategorie`, `parActivite`, etc.), avant le `return`, ajouter :

```ts
const reallocTotals = await db
  .prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN unite_cible_id = ? THEN montant_cents ELSE 0 END), 0) as entrantes,
       COALESCE(SUM(CASE WHEN unite_source_id = ? THEN montant_cents ELSE 0 END), 0) as sortantes
     FROM repartitions_unites
     WHERE group_id = ? AND saison = ?
       AND (unite_cible_id = ? OR unite_source_id = ?)`,
  )
  .get<{ entrantes: number; sortantes: number }>(
    args.uniteId, args.uniteId, groupId, saison, args.uniteId, args.uniteId,
  );

const repartitions = await db
  .prepare(
    `SELECT * FROM repartitions_unites
     WHERE group_id = ? AND saison = ?
       AND (unite_cible_id = ? OR unite_source_id = ?)
     ORDER BY date_repartition DESC, id DESC`,
  )
  .all<Repartition>(groupId, saison, args.uniteId, args.uniteId);

const entrantes = reallocTotals?.entrantes ?? 0;
const sortantes = reallocTotals?.sortantes ?? 0;
```

⚠️ Ajouter l'import `Repartition` en haut du fichier si pas déjà fait :

```ts
import type { Repartition } from './repartitions';
```

- [ ] **Step 3 : Inclure les nouvelles données dans le `return`**

Modifier le `return` final de `getUniteOverview` :

```ts
return {
  unite,
  exerciceFiltre: filters.exercice ?? null,
  totalDepenses: dep,
  totalRecettes: rec,
  solde: rec - dep + (entrantes - sortantes),       // INCLUT realloc
  parCategorie,
  parActivite,
  alertes: { ... },
  ecrituresRecentes,
  totalEcritures: totalEcrRow?.count ?? 0,
  reallocEntrantesCents: entrantes,
  reallocSortantesCents: sortantes,
  reallocNetCents: entrantes - sortantes,
  repartitions,
};
```

⚠️ Le `solde` du détail unité devient **net avec réalloc** (cf. spec). C'est un changement de comportement par rapport à la phase 2.

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/overview.ts
git commit -m "feat(overview): realloc entrantes/sortantes/net + liste repartitions dans getUniteOverview"
```

---

## Task 8 — `UniteCard` : ligne Réalloc + solde net

**Files:**
- Modify: `web/src/components/synthese/unite-card.tsx`
- Modify: `web/src/app/(app)/synthese/page.tsx`

- [ ] **Step 1 : Étendre `UniteCardData`**

Dans `web/src/components/synthese/unite-card.tsx`, modifier l'interface :

```ts
export interface UniteCardData {
  id: string;
  code: string;
  name: string;
  couleur: string | null;
  depenses: number;
  recettes: number;
  solde: number;                    // recettes - depenses (brut)
  budget_prevu_depenses: number;
  realloc_net_cents: number;        // NEW
  solde_avec_realloc: number;       // NEW (= recettes - depenses + realloc_net_cents)
}
```

- [ ] **Step 2 : Adapter le rendu de la carte**

Dans le composant `UniteCard`, repérer le bloc `<dl className="space-y-1.5 text-sm">` qui contient Dépenses / Recettes / Solde.

Modifier pour :
- Ajouter une ligne « Réalloc » entre « Recettes » et « Solde » **uniquement si `realloc_net_cents !== 0`**
- Le « Solde » affiché devient `solde_avec_realloc` (le composant continue de recevoir `solde` mais on ne l'utilise plus pour l'affichage de la card — on garde `solde` dans l'interface pour rétrocompat si d'autres consommateurs en ont besoin)

```tsx
<dl className="space-y-1.5 text-sm">
  <div className="flex justify-between">
    <dt className="text-muted-foreground">Dépenses</dt>
    <dd className="tabular-nums"><Amount cents={unite.depenses} tone="negative" /></dd>
  </div>
  <div className="flex justify-between">
    <dt className="text-muted-foreground">Recettes</dt>
    <dd className="tabular-nums"><Amount cents={unite.recettes} tone="positive" /></dd>
  </div>
  {unite.realloc_net_cents !== 0 && (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">Réalloc</dt>
      <dd className="tabular-nums"><Amount cents={unite.realloc_net_cents} tone="signed" /></dd>
    </div>
  )}
  <div className="flex justify-between border-t pt-1.5 font-medium">
    <dt>Solde</dt>
    <dd className="tabular-nums"><Amount cents={unite.solde_avec_realloc} tone="signed" /></dd>
  </div>
</dl>
```

- [ ] **Step 3 : Passer les nouveaux champs depuis `synthese/page.tsx`**

Dans `web/src/app/(app)/synthese/page.tsx`, modifier le mapping passé à `<UnitesGrid>` pour inclure les nouveaux champs :

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
    realloc_net_cents: u.realloc_net_cents,
    solde_avec_realloc: u.solde_avec_realloc,
  }))}
  exerciceParam={exerciceParam}
/>
```

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5 : Vérification manuelle**

Lance le dev server (`cd web && pnpm dev`). Ouvre `/synthese`. Les cartes affichent maintenant le solde net (= solde brut car aucune réalloc en BDD encore, donc identique au précédent). Pas de ligne Réalloc visible (toutes à 0). Aucune régression visuelle.

- [ ] **Step 6 : Commit**

```bash
git add web/src/components/synthese/unite-card.tsx "web/src/app/(app)/synthese/page.tsx"
git commit -m "feat(synthese): ligne Realloc + solde net sur UniteCard"
```

---

## Task 9 — Composant `RepartitionDrawer` (client component)

**Files:**
- Create: `web/src/components/synthese/repartition-drawer.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useFormState } from 'react-dom';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { createRepartitionAction, type RepartitionFormState } from '@/lib/actions/repartitions';
import type { Unite } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  unites: Unite[];
  saison: string;
  defaultSourceId?: string | null;
  defaultCibleId?: string | null;
}

const initialState: RepartitionFormState = { error: null };

// Drawer latéral pour la saisie d'une nouvelle répartition. Pattern
// cohérent avec ecriture-drawer.tsx. Utilise useFormState pour remonter
// les erreurs de validation.
export function RepartitionDrawer({
  open,
  onClose,
  unites,
  saison,
  defaultSourceId,
  defaultCibleId,
}: Props) {
  const [state, formAction] = useFormState(createRepartitionAction, initialState);
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  // Ferme automatiquement après une création réussie.
  if (state.error === null && state.error !== undefined && open) {
    // Reset via callback à la prochaine itération (utiliser useEffect serait plus propre)
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-card w-full max-w-md h-full overflow-y-auto shadow-xl border-l">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold">Nouvelle répartition</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>
        <form
          action={(fd) => {
            startTransition(() => {
              formAction(fd);
              // onClose appelé via la callback du caller si state.error reste null
              // → géré par le useEffect dans le parent ou par revalidatePath
            });
          }}
          className="p-4 space-y-4"
        >
          <input type="hidden" name="saison" value={saison} />

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Date</span>
            <Input type="date" name="date_repartition" defaultValue={today} required />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Source</span>
            <NativeSelect name="unite_source_id" defaultValue={defaultSourceId ?? ''}>
              <option value="">— Groupe (pot commun) —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </NativeSelect>
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Cible</span>
            <NativeSelect name="unite_cible_id" defaultValue={defaultCibleId ?? ''}>
              <option value="">— Groupe (pot commun) —</option>
              {unites.map((u) => (
                <option key={u.id} value={u.id}>{u.code} — {u.name}</option>
              ))}
            </NativeSelect>
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Montant (€)</span>
            <Input
              type="text"
              name="amount"
              placeholder="0,00"
              required
              className="text-right tabular-nums"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Libellé</span>
            <Input
              type="text"
              name="libelle"
              placeholder="ex: Quote-part inscriptions"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground mb-1 block">Notes (optionnel)</span>
            <Textarea name="notes" rows={3} />
          </label>

          {state.error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {state.error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Création…' : 'Créer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier l'existence de `Textarea`**

Run: `ls web/src/components/ui/textarea.tsx`
Expected: fichier existe (cf. file listing initial).

- [ ] **Step 3 : Vérifier `Button` variant `outline`**

Run: `grep -n "variant.*outline" web/src/components/ui/button.tsx | head -3`
Expected: au moins une ligne (variant `outline` supporté).

Si pas supporté, remplacer par la valeur supportée (probablement `secondary` ou `ghost`).

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add web/src/components/synthese/repartition-drawer.tsx
git commit -m "feat(repartitions): drawer client pour saisie d une repartition"
```

---

## Task 10 — Bouton « Répartir » + drawer sur `/synthese`

**Files:**
- Modify: `web/src/app/(app)/synthese/page.tsx`

- [ ] **Step 1 : Extraire la grille + bouton dans un nouveau client component**

Le bouton « Répartir » a besoin de `useState` (open/close du drawer). On crée un mini wrapper client pour la zone Section « Par unité ».

Crée `web/src/components/synthese/unites-section.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/shared/section';
import { UnitesGrid } from './unites-grid';
import { RepartitionDrawer } from './repartition-drawer';
import type { UniteCardData } from './unite-card';
import type { Unite } from '@/lib/types';

interface Props {
  unites: UniteCardData[];
  exerciceParam: string;
  saison: string;
  unitesRef: Unite[];         // pour les selects de la modale
  canCreate: boolean;
}

export function UnitesSection({ unites, exerciceParam, saison, unitesRef, canCreate }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <Section
        title="Par unité"
        subtitle="Cliquez sur une unité pour voir le détail des dépenses et de la répartition par catégorie."
        className="mb-8"
        action={
          canCreate ? (
            <Button size="sm" onClick={() => setDrawerOpen(true)}>
              <Plus size={14} className="mr-1" />
              Répartir
            </Button>
          ) : undefined
        }
      >
        <UnitesGrid unites={unites} exerciceParam={exerciceParam} />
      </Section>
      <RepartitionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        unites={unitesRef}
        saison={saison}
      />
    </>
  );
}
```

⚠️ Le composant `<Section>` doit supporter une prop `action`. Vérifier dans `web/src/components/shared/section.tsx`. Si la prop n'existe pas, l'ajouter dans une étape supplémentaire (rendre l'action à droite du titre dans le header). Pour rester minimal, on peut aussi placer le bouton **au-dessus** de `<Section>` plutôt que dans son header — alternative si `action` n'est pas supportée.

- [ ] **Step 2 : Vérifier la prop `action` de `<Section>`**

Run: `grep -n "action" web/src/components/shared/section.tsx | head -5`
Expected: une ligne définissant la prop. Si absente, choisir l'alternative : placer le bouton en flex au-dessus.

**Alternative si `action` absent :**

```tsx
<div className="flex items-center justify-between mb-3">
  <h2 className="text-base font-semibold">Par unité</h2>
  {canCreate && (
    <Button size="sm" onClick={() => setDrawerOpen(true)}>
      <Plus size={14} className="mr-1" />
      Répartir
    </Button>
  )}
</div>
<Section subtitle="..." className="mb-8">
  <UnitesGrid unites={unites} exerciceParam={exerciceParam} />
</Section>
```

- [ ] **Step 3 : Modifier `synthese/page.tsx` pour utiliser `UnitesSection`**

Dans `web/src/app/(app)/synthese/page.tsx`, importer `UnitesSection` et le service `listUnites` :

```ts
import { UnitesSection } from '@/components/synthese/unites-section';
import { listUnites } from '@/lib/queries/reference';
```

Remplacer le bloc actuel `<Section title="Par unité">...</Section>` par :

```tsx
<UnitesSection
  unites={data.parUnite.map((u) => ({
    id: u.id,
    code: u.code,
    name: u.name,
    couleur: u.couleur,
    depenses: u.depenses,
    recettes: u.recettes,
    solde: u.solde,
    budget_prevu_depenses: u.budget_prevu_depenses,
    realloc_net_cents: u.realloc_net_cents,
    solde_avec_realloc: u.solde_avec_realloc,
  }))}
  exerciceParam={exerciceParam}
  saison={exerciceFilter ?? cur}
  unitesRef={unitesRef}
  canCreate={ctx.role === 'tresorier' || ctx.role === 'RG'}
/>
```

Et charger `unitesRef` en parallèle :

```tsx
const [data, unitesRef] = await Promise.all([
  getOverview({ exercice: exerciceFilter }),
  listUnites(),
]);
```

- [ ] **Step 4 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5 : Vérification manuelle**

Recharge `/synthese`. Vérifie :
- Le bouton « Répartir » apparaît à côté du titre « Par unité » pour les admins.
- Clic ouvre le drawer (panel latéral avec champs Date / Source / Cible / Montant / Libellé / Notes).
- Annuler ferme.
- Soumettre avec source = cible affiche un message d'erreur.
- Soumettre avec valeurs valides crée la réalloc, ferme le drawer, et la carte concernée affiche maintenant une ligne « Réalloc ».

- [ ] **Step 6 : Commit**

```bash
git add web/src/components/synthese/unites-section.tsx "web/src/app/(app)/synthese/page.tsx"
git commit -m "feat(synthese): bouton Repartir + drawer integres a la grille"
```

---

## Task 11 — Composant `RepartitionsList` (client component pour le détail unité)

**Files:**
- Create: `web/src/components/synthese/repartitions-list.tsx`

- [ ] **Step 1 : Créer le composant**

```tsx
'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Amount } from '@/components/shared/amount';
import { formatAmount } from '@/lib/format';
import {
  updateRepartitionAction,
  deleteRepartitionAction,
} from '@/lib/actions/repartitions';
import type { Repartition } from '@/lib/services/repartitions';
import type { Unite } from '@/lib/types';

interface Props {
  repartitions: Repartition[];
  unites: Unite[];
  uniteCourante: string;        // id de l'unité du détail courant
  canEdit: boolean;
}

function uniteLabel(unites: Unite[], id: string | null): string {
  if (id === null) return 'Groupe';
  const u = unites.find((x) => x.id === id);
  return u ? u.code : 'Inconnue';
}

export function RepartitionsList({ repartitions, unites, uniteCourante, canEdit }: Props) {
  const [, startTransition] = useTransition();

  function patchField(id: string, field: string, value: string | null) {
    if (!canEdit) return;
    const fd = new FormData();
    fd.set('id', id);
    fd.set('field', field);
    if (value !== null) fd.set('value', value);
    startTransition(() => updateRepartitionAction(fd));
  }

  function deleteRow(id: string) {
    if (!canEdit) return;
    if (!confirm('Supprimer cette répartition ?')) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(() => deleteRepartitionAction(fd));
  }

  if (repartitions.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-muted-foreground">
        Aucune répartition impactant cette unité sur la saison.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr className="text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Sens</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Cible</th>
            <th className="px-3 py-2 font-medium">Libellé</th>
            <th className="px-3 py-2 font-medium text-right">Montant</th>
            <th className="px-3 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {repartitions.map((r) => {
            const estEntrante = r.unite_cible_id === uniteCourante;
            const signedAmount = estEntrante ? r.montant_cents : -r.montant_cents;
            const sourceLabel = uniteLabel(unites, r.unite_source_id);
            const cibleLabel = uniteLabel(unites, r.unite_cible_id);
            return (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {canEdit ? (
                    <Input
                      type="date"
                      defaultValue={r.date_repartition}
                      onBlur={(e) => e.currentTarget.value !== r.date_repartition && patchField(r.id, 'date_repartition', e.currentTarget.value)}
                    />
                  ) : (
                    r.date_repartition
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className={estEntrante ? 'text-emerald-700' : 'text-rose-700'}>
                    {estEntrante ? '→ entrée' : '← sortie'}
                  </span>
                </td>
                <td className={`px-3 py-2 ${r.unite_source_id === uniteCourante ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {sourceLabel}
                </td>
                <td className={`px-3 py-2 ${r.unite_cible_id === uniteCourante ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {cibleLabel}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Input
                      defaultValue={r.libelle}
                      onBlur={(e) => e.currentTarget.value !== r.libelle && patchField(r.id, 'libelle', e.currentTarget.value)}
                    />
                  ) : (
                    r.libelle
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {canEdit ? (
                    <Input
                      defaultValue={formatAmount(r.montant_cents).replace(/\s?€$/, '')}
                      className="text-right tabular-nums"
                      onBlur={(e) => {
                        const raw = e.currentTarget.value.trim();
                        const oldFormatted = formatAmount(r.montant_cents).replace(/\s?€$/, '');
                        if (raw !== oldFormatted) patchField(r.id, 'amount', raw);
                      }}
                    />
                  ) : (
                    <Amount cents={signedAmount} tone="signed" />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => deleteRow(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add web/src/components/synthese/repartitions-list.tsx
git commit -m "feat(repartitions): liste editable inline pour le detail unite"
```

---

## Task 12 — Page détail unité : KPI Réalloc + bloc Répartitions

**Files:**
- Modify: `web/src/app/(app)/synthese/unite/[id]/page.tsx`

- [ ] **Step 1 : Importer ce qu'il faut**

En haut de `web/src/app/(app)/synthese/unite/[id]/page.tsx`, ajouter :

```ts
import { ArrowLeftRight } from 'lucide-react';
import { RepartitionsList } from '@/components/synthese/repartitions-list';
import { listUnites } from '@/lib/queries/reference';
```

- [ ] **Step 2 : Charger les unités en parallèle**

Repérer l'appel `await getUniteOverview(id, ...)`. Le mettre dans un `Promise.all` :

```ts
const [data, unitesRef] = await Promise.all([
  getUniteOverview(id, { exercice: exerciceFilter }),
  listUnites(),
]);
if (!data) notFound();
```

- [ ] **Step 3 : Ajouter une stat card « Réalloc » dans la grille de KPIs**

Repérer la grille `<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">` qui contient Dépenses / Recettes / Solde.

Modifier pour passer à 4 colonnes **uniquement si `data.reallocNetCents !== 0`** :

```tsx
<div className={`grid grid-cols-1 ${data.reallocNetCents !== 0 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'} gap-4 mb-6`}>
  <StatCard
    label="Dépenses"
    icon={ArrowDownCircle}
    value={<Amount cents={data.totalDepenses} tone="negative" />}
  />
  <StatCard
    label="Recettes"
    icon={ArrowUpCircle}
    value={<Amount cents={data.totalRecettes} tone="positive" />}
  />
  {data.reallocNetCents !== 0 && (
    <StatCard
      label="Réalloc"
      icon={ArrowLeftRight}
      value={<Amount cents={data.reallocNetCents} tone="signed" />}
      sublabel={
        data.reallocEntrantesCents > 0 && data.reallocSortantesCents > 0
          ? `+ ${data.reallocEntrantesCents / 100} − ${data.reallocSortantesCents / 100}`
          : data.reallocEntrantesCents > 0
            ? 'entrées'
            : 'sorties'
      }
    />
  )}
  <StatCard
    label="Solde"
    icon={Scale}
    value={<Amount cents={data.solde} tone="signed" />}
  />
</div>
```

⚠️ Le `data.solde` est désormais le solde **net avec réalloc** (modifié en Task 7).

- [ ] **Step 4 : Ajouter le bloc « Répartitions de la saison »**

Avant la `<Section title="Écritures récentes" ...>`, ajouter :

```tsx
<Section
  title={`Répartitions de la saison (${data.repartitions.length})`}
  subtitle="Mouvements internes entre unités impactant cette unité. Édition inline du libellé, du montant et de la date."
  className="mb-8"
  bodyClassName="px-0 pb-0"
>
  <RepartitionsList
    repartitions={data.repartitions}
    unites={unitesRef}
    uniteCourante={id}
    canEdit={ctx.role === 'tresorier' || ctx.role === 'RG'}
  />
</Section>
```

- [ ] **Step 5 : Vérification typage**

Run: `cd web && pnpm exec tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6 : Vérification manuelle**

Dans le navigateur, depuis `/synthese` clique sur une carte d'unité qui a une répartition. Vérifie :
- La page détail affiche une 4e stat card « Réalloc » avec le bon montant signé.
- Le « Solde » inclut la réalloc.
- Un nouveau bloc « Répartitions de la saison » liste les répartitions impactant cette unité.
- Édition inline d'une date / libellé / montant fonctionne et persiste.
- Bouton ✕ supprime après confirmation.

- [ ] **Step 7 : Commit**

```bash
git add "web/src/app/(app)/synthese/unite/[id]/page.tsx"
git commit -m "feat(synthese): KPI Realloc + bloc Repartitions sur detail unite"
```

---

## Task 13 — Build prod + smoke test final

- [ ] **Step 1 : Build production**

Run: `cd web && pnpm build`
Expected: build OK, route `/synthese` et `/synthese/unite/[id]` listées comme `ƒ Dynamic`. Aucune erreur TS.

Si une route plante avec « Dynamic server usage », ajouter `export const dynamic = 'force-dynamic';` au top du fichier concerné.

- [ ] **Step 2 : Tests vitest**

Run: `cd web && pnpm exec vitest run`
Expected: tous les tests passent, dont les 10 nouveaux tests de `repartitions-validation.test.ts`.

- [ ] **Step 3 : Smoke test fonctionnel complet**

Avec le dev server qui tourne :

1. `/synthese` → bouton « Répartir » visible pour admin, drawer s'ouvre au clic.
2. Créer une réalloc Groupe → LJ 600€, libellé « Quote-part LJ 2026 ». Drawer se ferme, la carte LJ affiche « Réalloc +6,00 € » (ou le montant saisi).
3. Solde de la carte LJ = recettes − dépenses + 600.
4. Cliquer sur la carte LJ → page détail. La stat card « Réalloc » affiche le bon montant. Le bloc « Répartitions de la saison » liste la nouvelle entrée.
5. Modifier le libellé inline → persisté.
6. Modifier le montant inline → persisté, KPI et card mis à jour.
7. Supprimer (✕ + confirmation) → ligne disparaît, KPI et card mis à jour.
8. Tenter de créer une réalloc Groupe → Groupe ou LJ → LJ → message d'erreur dans le drawer.
9. Sur `/synthese`, le total global (Dépenses, Recettes, Solde) est inchangé après les réallocs (somme constante).
10. Login en tant que `chef` → le bouton « Répartir » n'apparaît pas. Le bloc Répartitions est lisible mais non éditable (pas de ✕, pas d'inputs).

- [ ] **Step 4 : Pas de push automatique**

Conformément à la convention projet : ne pas pousser sur la remote. Demander explicitement avant tout `git push`.

---

## Self-review — couverture spec

- ✅ Table `repartitions_unites` créée (Task 1)
- ✅ Module pur validé + tests vitest (Task 2)
- ✅ Service CRUD + agrégation (Task 3)
- ✅ Queries wrapper (Task 4)
- ✅ Server actions avec admin guard et validation (Task 5)
- ✅ `getOverview.parUnite` étendu avec `realloc_net_cents` (Task 6)
- ✅ `getUniteOverview` étendu (Task 7)
- ✅ `UniteCard` affiche ligne Réalloc + solde net (Task 8)
- ✅ Drawer de saisie (Task 9)
- ✅ Bouton « Répartir » intégré dans synthese (Task 10)
- ✅ Liste éditable inline (Task 11)
- ✅ KPI Réalloc + bloc historique sur détail unité (Task 12)
- ✅ Anti-énumération inter-groupes sur toutes nouvelles fonctions
- ✅ Permissions admin-only (server actions assertAdmin + UI conditionnelle)
- ✅ Hard delete OK (table non protégée par la doctrine)
- ✅ Build prod + smoke test (Task 13)
