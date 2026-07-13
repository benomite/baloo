# Ventiler un draft existant — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de ventiler un draft existant (non encore dans CW) en N lignes — chacune avec ses 3 dimensions CW (catégorie, activité, unité) — et le pousser en 1 seule pièce Comptaweb à N ventilations.

**Architecture:** On réutilise le socle S0 (colonne `ventilation_group_id`, type `VentilationInput`, adapter CW `buildCwInputFromPayload`, regroupement d'affichage `buildEcritureGroups`). Un service d'éclatement atomique transforme un draft unique en N lignes groupées en préservant la ligne « tête » (id existant → justifs/notes/liens/identité bancaire intacts). Le chemin de push draft→CW (`syncDraftToComptaweb`) et le self-heal du scan bancaire sont débridés pour opérer sur le groupe. L'UI est un éditeur inline dans le panneau (modèle « défauts globaux + lignes légères »), sans modale.

**Tech Stack:** Next 16 (App Router), TypeScript, libsql/Turso, Zod, vitest, React (client components).

## Global Constraints

- **Périmètre strict** : on ne ventile QUE `status = 'draft'` **et** `comptaweb_ecriture_id IS NULL`. `mirror`/`divergent`/`pending_sync` interdits (déjà/en cours dans CW).
- **JAMAIS de DELETE de donnée métier** (CLAUDE.md). Le collapse ne supprime une ligne surnuméraire que via `deleteDraftEcriture` (garde-fou : `draft` + aucun justif/dépôt/remboursement attaché). Une ligne surnuméraire avec pièce attachée **bloque** l'opération.
- **Préserver la tête** : la ligne « tête » (l'id passé par l'appelant) est **mise à jour**, jamais recréée → justifs, notes, liens (dépôt/remboursement) et identité bancaire (`ligne_bancaire_id`, `ligne_bancaire_sous_index`, `libelle_origine`) restent intacts.
- **`ventilation_group_id`** = `vg_${randomUUID()}` si N ≥ 2, `null` si N = 1 (réutiliser le vg existant du groupe si déjà posé et N reste ≥ 2).
- **Atomicité** : toute mutation multi-lignes est dans un seul `db.transaction(async (txDb) => {...})` (pattern `createEcritureAndPushToCw`, `batchUpdateEcritures`).
- **Montants** en centimes ; format FR `"42,50"` en UI ; conversions via `parseAmount`/`formatAmount` (`@/lib/format`).
- **Le total est le total du GROUPE** (Σ des montants des lignes actuelles), pas le montant de la seule ligne tête. Le serveur est autoritaire sur ce total ; le body de l'endpoint ne le porte pas.
- **Pas de CHECK SQL** ; validation métier côté code.
- **Pas de migration** : `ventilation_group_id` existe déjà (S0).
- **Réutiliser** : `VentilationInput` (`ecritures-create.ts`), `ventilations-form.ts`, `buildCwInputFromPayload` (`ecritures-create-cw-adapter.ts`), `buildEcritureGroups` (`ecriture-groups.ts`), `deleteDraftEcriture` (`ecritures.ts`).
- **Pas de `git push`** sans accord explicite de l'utilisateur.

---

## File Structure

- `web/src/components/ecritures/ventilate-editor-model.ts` — **créer** : logique pure de l'éditeur (résolution défauts+surcharges → ventilations, reste à ventiler, `canSave`, `isMultiCategory`).
- `web/src/lib/services/ecritures-ventilate.ts` — **créer** : service `ventilateDraft` (éclatement/collapse atomique).
- `web/src/app/api/ecritures/[id]/ventilations/route.ts` — **créer** : endpoint `PUT`.
- `web/src/lib/services/drafts.ts` — **modifier** : `syncDraftToComptaweb` (N ventilations) ; `scanDraftsFromComptaweb` (self-heal groupe).
- `web/src/components/ecritures/ventilation-editor.tsx` — **créer** : composant React (modèle « défauts globaux + lignes légères »).
- `web/src/components/ecritures/ecriture-inline-panel.tsx` — **modifier** : brancher l'éditeur + trigger « + Ajouter un détail ».

---

### Task 1: Module pur — modèle de l'éditeur de ventilation

**Files:**
- Create: `web/src/components/ecritures/ventilate-editor-model.ts`
- Test: `web/src/components/ecritures/__tests__/ventilate-editor-model.test.ts`

**Interfaces:**
- Consumes: `parseAmount` from `@/lib/format`.
- Produces (utilisés par Task 6) :
  - `interface DefaultImputation { unite_id: string | null; activite_id: string | null }`
  - `interface DetailRow { id: string; amount: string; category_id: string | null; override: DefaultImputation | null }`
  - `interface ResolvedVentilation { amount_cents: number; category_id: string | null; unite_id: string | null; activite_id: string | null }`
  - `resolveVentilations(defaults: DefaultImputation, rows: DetailRow[]): ResolvedVentilation[]`
  - `editorRemainderCents(totalCents: number, rows: DetailRow[]): number`
  - `isMultiCategory(rows: DetailRow[]): boolean`
  - `canSaveVentilation(totalCents: number, defaults: DefaultImputation, rows: DetailRow[]): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/ecritures/__tests__/ventilate-editor-model.test.ts
import { describe, it, expect } from 'vitest';
import {
  resolveVentilations,
  editorRemainderCents,
  isMultiCategory,
  canSaveVentilation,
  type DetailRow,
  type DefaultImputation,
} from '../ventilate-editor-model';

const defaults: DefaultImputation = { unite_id: 'u-farfa', activite_id: 'a-camps' };
const row = (over: Partial<DetailRow>): DetailRow => ({
  id: over.id ?? 'r1', amount: over.amount ?? '0', category_id: over.category_id ?? null,
  override: over.override ?? null,
});

describe('resolveVentilations', () => {
  it('applique les défauts unité/activité à une ligne sans surcharge', () => {
    const out = resolveVentilations(defaults, [row({ amount: '7,00', category_id: 'c-intendance' })]);
    expect(out).toEqual([{ amount_cents: 700, category_id: 'c-intendance', unite_id: 'u-farfa', activite_id: 'a-camps' }]);
  });

  it('respecte la surcharge par ligne', () => {
    const out = resolveVentilations(defaults, [
      row({ amount: '3,64', category_id: 'c-pharma', override: { unite_id: 'u-louv', activite_id: 'a-we' } }),
    ]);
    expect(out[0].unite_id).toBe('u-louv');
    expect(out[0].activite_id).toBe('a-we');
  });
});

describe('editorRemainderCents', () => {
  it('reste = total - somme des lignes', () => {
    expect(editorRemainderCents(1064, [row({ amount: '7,00' }), row({ id: 'r2', amount: '3,64' })])).toBe(0);
    expect(editorRemainderCents(1064, [row({ amount: '7,00' })])).toBe(364);
  });
});

describe('isMultiCategory', () => {
  it('vrai dès 2 lignes', () => {
    expect(isMultiCategory([row({})])).toBe(false);
    expect(isMultiCategory([row({}), row({ id: 'r2' })])).toBe(true);
  });
});

describe('canSaveVentilation', () => {
  const complete: DetailRow[] = [
    row({ id: 'r1', amount: '7,00', category_id: 'c-intendance' }),
    row({ id: 'r2', amount: '3,64', category_id: 'c-pharma' }),
  ];
  it('vrai si équilibré et toutes les lignes complètes', () => {
    expect(canSaveVentilation(1064, defaults, complete)).toBe(true);
  });
  it('faux si déséquilibré', () => {
    expect(canSaveVentilation(2000, defaults, complete)).toBe(false);
  });
  it('faux si une catégorie manque', () => {
    expect(canSaveVentilation(1064, defaults, [complete[0], { ...complete[1], category_id: null }])).toBe(false);
  });
  it('faux si une unité résolue manque (défaut vide, pas de surcharge)', () => {
    expect(canSaveVentilation(1064, { unite_id: null, activite_id: 'a-camps' }, complete)).toBe(false);
  });
  it('faux si un montant est nul', () => {
    expect(canSaveVentilation(700, defaults, [{ ...complete[0] }, { ...complete[1], amount: '0' }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/ecritures/__tests__/ventilate-editor-model.test.ts`
Expected: FAIL — module `../ventilate-editor-model` introuvable.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/components/ecritures/ventilate-editor-model.ts
// Logique pure de l'éditeur de ventilation d'un draft (modèle « défauts
// globaux + lignes légères », cf. spec 2026-07-13). Aucune dépendance
// React/DOM : résout les lignes UI en ventilations résolues, calcule le
// reste à ventiler (total FIGÉ) et l'état d'activation du bouton d'enreg.

import { parseAmount } from '@/lib/format';

export interface DefaultImputation {
  unite_id: string | null;
  activite_id: string | null;
}

// Une ligne de détail : catégorie + montant, et une surcharge optionnelle
// unité/activité (le ⚙). `override === null` → hérite du bloc « défaut ».
export interface DetailRow {
  id: string;
  amount: string;
  category_id: string | null;
  override: DefaultImputation | null;
}

export interface ResolvedVentilation {
  amount_cents: number;
  category_id: string | null;
  unite_id: string | null;
  activite_id: string | null;
}

export function resolveVentilations(defaults: DefaultImputation, rows: DetailRow[]): ResolvedVentilation[] {
  return rows.map((r) => {
    const imp = r.override ?? defaults;
    return {
      amount_cents: parseAmount(r.amount || '0'),
      category_id: r.category_id || null,
      unite_id: imp.unite_id || null,
      activite_id: imp.activite_id || null,
    };
  });
}

export function editorRemainderCents(totalCents: number, rows: DetailRow[]): number {
  return totalCents - rows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0);
}

export function isMultiCategory(rows: DetailRow[]): boolean {
  return rows.length >= 2;
}

export function canSaveVentilation(totalCents: number, defaults: DefaultImputation, rows: DetailRow[]): boolean {
  if (rows.length < 1) return false;
  if (editorRemainderCents(totalCents, rows) !== 0) return false;
  const resolved = resolveVentilations(defaults, rows);
  return resolved.every(
    (v) => v.amount_cents !== 0 && v.category_id !== null && v.unite_id !== null && v.activite_id !== null,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/ecritures/__tests__/ventilate-editor-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ecritures/ventilate-editor-model.ts web/src/components/ecritures/__tests__/ventilate-editor-model.test.ts
git commit -m "feat(ventilation): modèle pur de l'éditeur de ventilation d'un draft"
```

---

### Task 2: Service — `ventilateDraft` (éclatement/collapse atomique)

**Files:**
- Create: `web/src/lib/services/ecritures-ventilate.ts`
- Test: `web/src/lib/services/__tests__/ecritures-ventilate.test.ts`

**Interfaces:**
- Consumes: `VentilationInput` (`./ecritures-create`), `deleteDraftEcriture` + `EcritureContext` (`./ecritures`), `nextIdOn`, `currentTimestamp` (`../ids`), `getDb` + `DbWrapper` (`../db`).
- Produces (utilisé par Task 3) :
  - `type VentilateReason = 'not_found' | 'not_draft' | 'in_cw' | 'sum_mismatch' | 'incomplete' | 'child_has_attachments'`
  - `interface VentilateDraftResult { ok: boolean; reason?: VentilateReason; ventilation_group_id?: string | null; ids?: string[] }`
  - `ventilateDraft(ctx: EcritureContext, headId: string, ventilations: VentilationInput[], db?: DbWrapper): Promise<VentilateDraftResult>`

**Contrat :**
- `headId` = la ligne « tête » du groupe (celle ouverte dans le panneau). Elle est **mise à jour**, jamais recréée.
- Total autoritaire = Σ des montants des lignes actuelles du groupe (`headId.ventilation_group_id ? toutes : [headId]`). `sum_mismatch` si Σ ventilations demandées ≠ total.
- `incomplete` si une ventilation demandée a `amount_cents === 0` ou un `category_id`/`unite_id`/`activite_id` null.
- Chaque membre du groupe **autre que la tête** est supprimé via `deleteDraftEcriture` (garde-fou pièces) ; s'il a une pièce → `child_has_attachments`, rollback total.
- `ventilation_group_id` final = `vg_${randomUUID()}` si ≥ 2 ventilations (réutilise l'existant s'il y en avait un), sinon `null`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/services/__tests__/ecritures-ventilate.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let idCounter = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextIdOn: async (_db: unknown, p: string) => `${p}-${++idCounter}`,
  nextId: async (p: string) => `${p}-${++idCounter}`,
  currentTimestamp: () => '2026-07-13T10:00:00Z',
}));

import { ventilateDraft } from '../ecritures-ventilate';

async function setup(): Promise<DbWrapper> {
  idCounter = 0;
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT,
      mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT, carte_id TEXT,
      justif_attendu INTEGER DEFAULT 1, notes TEXT, ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER, libelle_origine TEXT,
      ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
      status TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT, ecriture_id TEXT);
  `);
  await db.prepare(
    `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
       category_id, unite_id, activite_id, ligne_bancaire_id, ligne_bancaire_sous_index,
       libelle_origine, status, created_at, updated_at)
     VALUES ('E1','g1','2026-05-13','LECLERC',1064,'depense','c-int','u-farfa','a-camps',
       999, 0, 'LECLERC', 'draft','t','t')`,
  ).run();
  return db;
}

const V = (amount_cents: number, category_id: string) => ({
  amount_cents, category_id, unite_id: 'u-farfa', activite_id: 'a-camps',
});

describe('ventilateDraft', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('éclate un draft en N lignes groupées, préserve l\'id tête', async () => {
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    expect(res.ok).toBe(true);
    expect(res.ids).toContain('E1');
    expect(res.ids).toHaveLength(2);
    const rows = await testDb.prepare(
      "SELECT id, amount_cents, category_id, ventilation_group_id, ligne_bancaire_id FROM ecritures WHERE group_id='g1' ORDER BY amount_cents DESC",
    ).all<{ id: string; amount_cents: number; category_id: string; ventilation_group_id: string; ligne_bancaire_id: number }>();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('E1'); // tête réutilisée (montant le plus haut = 700)
    expect(rows[0].amount_cents).toBe(700);
    expect(rows[0].ligne_bancaire_id).toBe(999); // identité bancaire préservée
    expect(rows[0].ventilation_group_id).toMatch(/^vg_/);
    expect(rows[1].ventilation_group_id).toBe(rows[0].ventilation_group_id);
  });

  it('refuse si Σ ≠ total du groupe', async () => {
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(200, 'c-pharma')]);
    expect(res).toMatchObject({ ok: false, reason: 'sum_mismatch' });
    const n = await testDb.prepare("SELECT COUNT(*) n FROM ecritures WHERE group_id='g1'").get<{ n: number }>();
    expect(n?.n).toBe(1); // rollback : rien créé
  });

  it('refuse une ventilation incomplète', async () => {
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [
      { amount_cents: 700, category_id: null, unite_id: 'u-farfa', activite_id: 'a-camps' }, V(364, 'c-pharma'),
    ]);
    expect(res).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  it('refuse mirror / déjà dans CW', async () => {
    await testDb.prepare("UPDATE ecritures SET comptaweb_ecriture_id = 42 WHERE id='E1'").run();
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    expect(res).toMatchObject({ ok: false, reason: 'in_cw' });
  });

  it('recolle un groupe en 1 ligne (collapse) et supprime la surnuméraire', async () => {
    await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(1064, 'c-int')]);
    expect(res.ok).toBe(true);
    expect(res.ventilation_group_id).toBeNull();
    const rows = await testDb.prepare("SELECT id, ventilation_group_id FROM ecritures WHERE group_id='g1'").all<{ id: string; ventilation_group_id: string | null }>();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('E1');
    expect(rows[0].ventilation_group_id).toBeNull();
  });

  it('bloque le collapse si une ligne surnuméraire porte une pièce', async () => {
    await ventilateDraft({ groupId: 'g1' }, 'E1', [V(700, 'c-int'), V(364, 'c-pharma')]);
    const child = await testDb.prepare("SELECT id FROM ecritures WHERE group_id='g1' AND id != 'E1'").get<{ id: string }>();
    await testDb.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('j1','ecriture',?)").run(child!.id);
    const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [V(1064, 'c-int')]);
    expect(res).toMatchObject({ ok: false, reason: 'child_has_attachments' });
    const n = await testDb.prepare("SELECT COUNT(*) n FROM ecritures WHERE group_id='g1'").get<{ n: number }>();
    expect(n?.n).toBe(2); // rollback : rien supprimé
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/ecritures-ventilate.test.ts`
Expected: FAIL — module `../ecritures-ventilate` introuvable.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/services/ecritures-ventilate.ts
// Éclatement / collapse d'un draft en N ventilations groupées. La ligne
// « tête » (headId) est mise à jour (jamais recréée) → justifs, notes,
// liens et identité bancaire préservés. Cf. spec 2026-07-13.

import { randomUUID } from 'node:crypto';
import { getDb, type DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { deleteDraftEcriture, type EcritureContext } from './ecritures';
import type { VentilationInput } from './ecritures-create';

export type VentilateReason =
  | 'not_found' | 'not_draft' | 'in_cw' | 'sum_mismatch' | 'incomplete' | 'child_has_attachments';

export interface VentilateDraftResult {
  ok: boolean;
  reason?: VentilateReason;
  ventilation_group_id?: string | null;
  ids?: string[];
}

interface HeadRow {
  id: string; group_id: string; date_ecriture: string; description: string;
  amount_cents: number; type: 'depense' | 'recette'; mode_paiement_id: string | null;
  numero_piece: string | null; carte_id: string | null; justif_attendu: number;
  notes: string | null; ligne_bancaire_id: number | null; ligne_bancaire_sous_index: number | null;
  libelle_origine: string | null; ventilation_group_id: string | null;
  comptaweb_ecriture_id: number | null; status: string;
}

class VentilateError extends Error {
  constructor(public reason: VentilateReason) { super(reason); }
}

export async function ventilateDraft(
  ctx: EcritureContext,
  headId: string,
  ventilations: VentilationInput[],
  db: DbWrapper = getDb(),
): Promise<VentilateDraftResult> {
  const head = await db.prepare(
    `SELECT id, group_id, date_ecriture, description, amount_cents, type, mode_paiement_id,
            numero_piece, carte_id, justif_attendu, notes, ligne_bancaire_id,
            ligne_bancaire_sous_index, libelle_origine, ventilation_group_id,
            comptaweb_ecriture_id, status
       FROM ecritures WHERE id = ? AND group_id = ?`,
  ).get<HeadRow>(headId, ctx.groupId);
  if (!head) return { ok: false, reason: 'not_found' };
  if (head.status !== 'draft') return { ok: false, reason: 'not_draft' };
  if (head.comptaweb_ecriture_id !== null) return { ok: false, reason: 'in_cw' };

  // Membres actuels du groupe (dont la tête).
  const members = head.ventilation_group_id
    ? await db.prepare(
        `SELECT id, amount_cents FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
      ).all<{ id: string; amount_cents: number }>(ctx.groupId, head.ventilation_group_id)
    : [{ id: head.id, amount_cents: head.amount_cents }];
  const total = members.reduce((s, m) => s + m.amount_cents, 0);

  // Validations métier (avant toute mutation).
  const sum = ventilations.reduce((s, v) => s + v.amount_cents, 0);
  if (sum !== total) return { ok: false, reason: 'sum_mismatch' };
  const incomplete = ventilations.some(
    (v) => v.amount_cents === 0 || !v.category_id || !v.unite_id || !v.activite_id,
  );
  if (incomplete) return { ok: false, reason: 'incomplete' };

  const now = currentTimestamp();
  const newVg = ventilations.length >= 2 ? (head.ventilation_group_id ?? `vg_${randomUUID()}`) : null;
  const ids: string[] = [];

  try {
    await db.transaction(async (txDb) => {
      // 1. Supprimer les membres autres que la tête (garde-fou pièces).
      for (const m of members) {
        if (m.id === head.id) continue;
        const del = await deleteDraftEcriture(ctx, m.id, txDb);
        if (!del.ok) {
          throw new VentilateError(del.reason === 'has_attachments' ? 'child_has_attachments' : 'not_draft');
        }
      }
      // 2. Mettre à jour la tête avec la 1ʳᵉ ventilation + le vg.
      const v0 = ventilations[0];
      await txDb.prepare(
        `UPDATE ecritures
            SET amount_cents = ?, category_id = ?, unite_id = ?, activite_id = ?,
                ventilation_group_id = ?, updated_at = ?
          WHERE id = ? AND group_id = ?`,
      ).run(v0.amount_cents, v0.category_id ?? null, v0.unite_id ?? null, v0.activite_id ?? null, newVg, now, head.id, ctx.groupId);
      ids.push(head.id);
      // 3. Insérer les ventilations 2..N (copie des champs d'en-tête de la tête).
      for (const v of ventilations.slice(1)) {
        const id = await nextIdOn(txDb, 'ECR');
        await txDb.prepare(
          `INSERT INTO ecritures (
             id, group_id, date_ecriture, description, amount_cents, type, unite_id,
             category_id, mode_paiement_id, activite_id, numero_piece, carte_id,
             justif_attendu, notes, ligne_bancaire_id, ligne_bancaire_sous_index,
             libelle_origine, ventilation_group_id, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        ).run(
          id, ctx.groupId, head.date_ecriture, head.description, v.amount_cents, head.type,
          v.unite_id ?? null, v.category_id ?? null, head.mode_paiement_id, v.activite_id ?? null,
          head.numero_piece, head.carte_id, head.justif_attendu, head.notes,
          head.ligne_bancaire_id, head.ligne_bancaire_sous_index, head.libelle_origine, newVg, now, now,
        );
        ids.push(id);
      }
    });
  } catch (err) {
    if (err instanceof VentilateError) return { ok: false, reason: err.reason };
    throw err;
  }

  return { ok: true, ventilation_group_id: newVg, ids };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/ecritures-ventilate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/ecritures-ventilate.ts web/src/lib/services/__tests__/ecritures-ventilate.test.ts
git commit -m "feat(ventilation): service ventilateDraft (éclatement/collapse atomique, préserve la tête)"
```

---

### Task 3: Endpoint API `PUT /api/ecritures/[id]/ventilations`

**Files:**
- Create: `web/src/app/api/ecritures/[id]/ventilations/route.ts`
- Test: `web/src/app/api/ecritures/[id]/__tests__/ventilations-route.test.ts`

**Interfaces:**
- Consumes: `ventilateDraft` + `VentilateReason` (`@/lib/services/ecritures-ventilate`), `requireApiContext`, `parseJsonBody`, `jsonError` (`@/lib/api/route-helpers`), `VentilationInput` (`@/lib/services/ecritures-create`).
- Note : le body ne porte PAS le total (dérivé serveur). Le service valide Σ.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/app/api/ecritures/[id]/__tests__/ventilations-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ventilateDraft = vi.fn();
vi.mock('@/lib/services/ecritures-ventilate', () => ({ ventilateDraft: (...a: unknown[]) => ventilateDraft(...a) }));
vi.mock('@/lib/api/route-helpers', () => ({
  requireApiContext: async () => ({ ctx: { groupId: 'g1', scopeUniteIds: [] } }),
  parseJsonBody: async (_req: Request, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }) => {
    const body = await (_req as Request).json();
    const r = schema.safeParse(body);
    return r.success ? { data: r.data } : { error: new Response('bad', { status: 400 }) };
  },
  jsonError: (msg: string, status: number) => new Response(msg, { status }),
}));

import { PUT } from '../ventilations/route';

const req = (body: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(body) });
const params = Promise.resolve({ id: 'E1' });

describe('PUT /api/ecritures/[id]/ventilations', () => {
  beforeEach(() => ventilateDraft.mockReset());

  it('renvoie 200 + le résultat quand le service accepte', async () => {
    ventilateDraft.mockResolvedValue({ ok: true, ventilation_group_id: 'vg_1', ids: ['E1', 'ECR-2'] });
    const res = await PUT(req({ ventilations: [
      { amount_cents: 700, category_id: 'c1', unite_id: 'u1', activite_id: 'a1' },
      { amount_cents: 364, category_id: 'c2', unite_id: 'u1', activite_id: 'a1' },
    ] }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ids: ['E1', 'ECR-2'] });
  });

  it('renvoie 409 sur sum_mismatch', async () => {
    ventilateDraft.mockResolvedValue({ ok: false, reason: 'sum_mismatch' });
    const res = await PUT(req({ ventilations: [{ amount_cents: 1, category_id: 'c', unite_id: 'u', activite_id: 'a' }] }), { params });
    expect(res.status).toBe(409);
  });

  it('renvoie 404 sur not_found', async () => {
    ventilateDraft.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await PUT(req({ ventilations: [{ amount_cents: 1, category_id: 'c', unite_id: 'u', activite_id: 'a' }] }), { params });
    expect(res.status).toBe(404);
  });

  it('renvoie 400 si ventilations vide', async () => {
    const res = await PUT(req({ ventilations: [] }), { params });
    expect(res.status).toBe(400);
    expect(ventilateDraft).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run "src/app/api/ecritures/[id]/__tests__/ventilations-route.test.ts"`
Expected: FAIL — `../ventilations/route` introuvable.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/app/api/ecritures/[id]/ventilations/route.ts
import { z } from 'zod';
import { ventilateDraft, type VentilateReason } from '@/lib/services/ecritures-ventilate';
import { jsonError, parseJsonBody, requireApiContext } from '@/lib/api/route-helpers';

const ventilationSchema = z.object({
  amount_cents: z.number().int(),
  category_id: z.string().nullable(),
  unite_id: z.string().nullable(),
  activite_id: z.string().nullable(),
});
const bodySchema = z.object({ ventilations: z.array(ventilationSchema).min(1) });

const STATUS: Record<VentilateReason, number> = {
  not_found: 404, not_draft: 409, in_cw: 409, sum_mismatch: 409, incomplete: 400, child_has_attachments: 409,
};
const MESSAGE: Record<VentilateReason, string> = {
  not_found: 'Écriture introuvable.',
  not_draft: 'Seul un brouillon peut être ventilé.',
  in_cw: 'Écriture déjà dans Comptaweb — non ventilable.',
  sum_mismatch: 'La somme des détails doit être égale au total.',
  incomplete: 'Chaque détail doit avoir montant, catégorie, activité et unité.',
  child_has_attachments: 'Une ligne à retirer porte une pièce jointe — détachez-la d\'abord.',
};

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;
  const { groupId, scopeUniteIds } = ctxR.ctx;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if ('error' in parsed) return parsed.error;

  const result = await ventilateDraft({ groupId, scopeUniteIds }, id, parsed.data.ventilations);
  if (!result.ok && result.reason) {
    return jsonError(MESSAGE[result.reason], STATUS[result.reason]);
  }
  return Response.json(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run "src/app/api/ecritures/[id]/__tests__/ventilations-route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/api/ecritures/[id]/ventilations/route.ts" "web/src/app/api/ecritures/[id]/__tests__/ventilations-route.test.ts"
git commit -m "feat(ventilation): endpoint PUT /api/ecritures/[id]/ventilations"
```

---

### Task 4: Débrider `syncDraftToComptaweb` → N ventilations en 1 pièce CW

**Files:**
- Modify: `web/src/lib/services/drafts.ts:322-431` (`syncDraftToComptaweb`)
- Test: `web/src/lib/services/__tests__/sync-draft-ventilation.test.ts` (créer)

**Interfaces:**
- Consumes: `createEcriture` (`../comptaweb/ecritures-write`) accepte déjà `ventilations: CreateEcritureInput['ventilations']` (N entrées) et valide Σ = montant (`buildPostBody`).
- Produces: comportement débridé — quand `ecr.ventilation_group_id` est non nul, la sync assemble **toutes** les lignes du groupe en N ventilations, POST unique, puis passe **toutes** les lignes en `mirror` atomiquement.

**Contexte de l'existant** (à transformer, `drafts.ts`) :
- Aujourd'hui `syncDraftToComptaweb` charge 1 `ecr`, calcule `missing` sur ses seuls champs, construit `input.ventilations = [{ montant, natureId, activiteId, brancheprojetId }]` (montant = total de l'unique ligne), POST, puis `UPDATE ... WHERE id = ?` (1 ligne).

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/services/__tests__/sync-draft-ventilation.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
const createEcriture = vi.fn();

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({ currentTimestamp: () => '2026-07-13T10:00:00Z', nextId: async (p: string) => `${p}-X` }));
// withAutoReLogin exécute juste le callback avec une config bidon ; createEcriture est mocké.
vi.mock('../comptaweb/session', () => ({ withAutoReLogin: async (fn: (cfg: unknown) => unknown) => fn({}) }));
vi.mock('../comptaweb/ecritures-write', () => ({ createEcriture: (...a: unknown[]) => createEcriture(...a) }));

import { syncDraftToComptaweb } from '../drafts';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT, activite_id TEXT,
      mode_paiement_id TEXT, numero_piece TEXT, status TEXT, justif_attendu INTEGER,
      carte_id TEXT, ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
      comptaweb_synced INTEGER DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE categories (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE activites (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE unites (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE modes_paiement (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT, type TEXT, comptaweb_id INTEGER);
  `);
  await db.exec(`
    INSERT INTO categories VALUES ('c-int', 11), ('c-pharma', 22);
    INSERT INTO activites VALUES ('a-camps', 5);
    INSERT INTO unites VALUES ('u-farfa', 7);
    INSERT INTO modes_paiement VALUES ('m-cb', 3);
    INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, unite_id, category_id, activite_id, mode_paiement_id, status, justif_attendu, ventilation_group_id, comptaweb_ecriture_id) VALUES
      ('E1','g1','2026-05-13','LECLERC',700,'depense','u-farfa','c-int','a-camps','m-cb','draft',1,'vg_1',NULL),
      ('E2','g1','2026-05-13','LECLERC',364,'depense','u-farfa','c-pharma','a-camps','m-cb','draft',1,'vg_1',NULL);
  `);
  return db;
}

describe('syncDraftToComptaweb — groupe multi-ventilation', () => {
  beforeEach(async () => { testDb = await setup(); createEcriture.mockReset(); });

  it('envoie N ventilations, montant = total, et passe TOUT le groupe en mirror', async () => {
    createEcriture.mockResolvedValue({ dryRun: false, ecritureId: 5001 });
    const res = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
    expect(res.ok).toBe(true);
    // 1 seul POST CW
    expect(createEcriture).toHaveBeenCalledTimes(1);
    const input = createEcriture.mock.calls[0][1] as { montant: string; ventilations: Array<{ montant: string; natureId: string }> };
    expect(input.montant).toBe('10,64');
    expect(input.ventilations).toHaveLength(2);
    expect(input.ventilations.map((v) => v.natureId).sort()).toEqual(['11', '22']);
    // Les 2 lignes du groupe passent mirror + synced
    const rows = await testDb.prepare("SELECT status, comptaweb_synced, comptaweb_ecriture_id FROM ecritures WHERE group_id='g1'").all<{ status: string; comptaweb_synced: number; comptaweb_ecriture_id: number }>();
    expect(rows.every((r) => r.status === 'mirror' && r.comptaweb_synced === 1 && r.comptaweb_ecriture_id === 5001)).toBe(true);
  });

  it('dry-run : ne mute rien, signale équilibre', async () => {
    createEcriture.mockResolvedValue({ dryRun: true });
    const res = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: true });
    expect(res.dryRun).toBe(true);
    const rows = await testDb.prepare("SELECT status FROM ecritures WHERE group_id='g1'").all<{ status: string }>();
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/sync-draft-ventilation.test.ts`
Expected: FAIL — le code actuel envoie 1 ventilation (montant 7,00) et ne mute que E1.

> ⚠️ Adapter les noms d'import mockés (`../comptaweb/session`, `../comptaweb/ecritures-write`) aux imports RÉELS de `drafts.ts` en tête de fichier avant de lancer. Si `withAutoReLogin`/`createEcriture` viennent d'un autre chemin, corriger le `vi.mock`.

- [ ] **Step 3: Write minimal implementation**

Refondre le corps de `syncDraftToComptaweb` (`drafts.ts`) ainsi :

1. Après avoir chargé `ecr` (la tête, par `id`), charger **les lignes du groupe** :
   ```ts
   const groupRows = ecr.ventilation_group_id
     ? await db.prepare(
         `SELECT id, amount_cents, category_id, activite_id, unite_id
            FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
       ).all<{ id: string; amount_cents: number; category_id: string | null; activite_id: string | null; unite_id: string | null }>(groupId, ecr.ventilation_group_id)
     : [{ id: ecr.id, amount_cents: ecr.amount_cents, category_id: ecr.category_id, activite_id: ecr.activite_id, unite_id: ecr.unite_id }];
   const totalCents = groupRows.reduce((s, r) => s + r.amount_cents, 0);
   ```
2. Résoudre les mappings CW **par ligne** et agréger `missing` (garder les checks d'en-tête existants : `comptaweb_ecriture_id`, mode). Pour chaque ligne :
   ```ts
   const ventilations: CreateEcritureInput['ventilations'] = [];
   for (const [i, r] of groupRows.entries()) {
     const natureCw = await lookupComptawebId('categories', r.category_id);
     const activiteCw = await lookupComptawebId('activites', r.activite_id);
     const uniteCw = await lookupComptawebId('unites', r.unite_id);
     const prefix = groupRows.length > 1 ? `Ventilation ${i + 1} — ` : '';
     if (!r.category_id) missing.push(`${prefix}nature`); else if (natureCw === null) missing.push(`${prefix}mapping nature`);
     if (!r.activite_id) missing.push(`${prefix}activité`); else if (activiteCw === null) missing.push(`${prefix}mapping activité`);
     if (!r.unite_id) missing.push(`${prefix}unité`); else if (uniteCw === null) missing.push(`${prefix}mapping unité`);
     ventilations.push({
       montant: (r.amount_cents / 100).toFixed(2).replace('.', ','),
       natureId: natureCw !== null ? String(natureCw) : '',
       activiteId: activiteCw !== null ? String(activiteCw) : '',
       brancheprojetId: uniteCw !== null ? String(uniteCw) : '',
     });
   }
   ```
   Conserver les checks d'en-tête (mode manquant/mapping, `comptaweb_ecriture_id !== null`) tels quels.
3. `input.montant` = total : `(totalCents / 100).toFixed(2).replace('.', ',')`. `input.ventilations = ventilations`. Le reste de `CreateEcritureInput` inchangé (mode, comptebancaire, carte, tiers).
4. Après succès CW, remplacer l'`UPDATE ... WHERE id = ?` par une transaction qui met **toutes les lignes du groupe** en `mirror` :
   ```ts
   await db.transaction(async (txDb) => {
     for (const r of groupRows) {
       await txDb.prepare(
         `UPDATE ecritures SET status = 'mirror', comptaweb_synced = 1,
            comptaweb_ecriture_id = ?, numero_piece = ?, updated_at = ? WHERE id = ? AND group_id = ?`,
       ).run(result.ecritureId ?? null, numeropiece, currentTimestamp(), r.id, groupId);
     }
   });
   ```
   (`numeropiece` reste calculé comme aujourd'hui à partir de la tête `ecr`.)

Garder le dry-run intact (aucune mutation ; message selon `missing.length`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/sync-draft-ventilation.test.ts`
Then full drafts suite: `cd web && pnpm vitest run src/lib/services/__tests__/ -t drafts` (ou le fichier de tests drafts existant).
Expected: PASS, et aucune régression sur les tests drafts existants (le cas mono-ventilation `ventilation_group_id IS NULL` doit rester identique).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/drafts.ts web/src/lib/services/__tests__/sync-draft-ventilation.test.ts
git commit -m "feat(ventilation): syncDraftToComptaweb pousse N ventilations en 1 pièce CW, groupe→mirror atomique"
```

---

### Task 5: `scanDraftsFromComptaweb` — self-heal sur tout le groupe

**Files:**
- Modify: `web/src/lib/services/drafts.ts:218-236` (bloc `existingCand` / self-heal)
- Test: `web/src/lib/services/__tests__/scan-drafts-group-selfheal.test.ts` (créer)

**Interfaces:**
- `planStaleLineDrafts` (`drafts-line-reconcile.ts`) clé sur `sous_index` : les N lignes d'un split partagent le même `sous_index` (toujours canonique) → **jamais prunées**. Aucune modif requise là.
- Seul changement : quand la tête reconnue est corrigée en sens (`type`), corriger **tous** les membres du groupe (`ventilation_group_id`), pas seulement la ligne trouvée par `.find`.

**Contexte existant** (`drafts.ts` ~218-235) : `correctDraftType.run(type, justifAttendu, ts, existingCand.id, groupId)` corrige 1 ligne.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/services/__tests__/scan-drafts-group-selfheal.test.ts
// Vérifie qu'un groupe de ventilation issu d'un split de sous-ligne bancaire
// (2 lignes, même sous_index) voit son SENS recalé sur TOUTES ses lignes,
// et qu'aucune n'est prunée comme stale. On teste le helper de correction
// de groupe extrait de scanDraftsFromComptaweb.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({ currentTimestamp: () => '2026-07-13T10:00:00Z', nextId: async (p: string) => `${p}-X` }));

import { correctGroupDraftType } from '../drafts';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, type TEXT, justif_attendu INTEGER,
      ventilation_group_id TEXT, status TEXT, comptaweb_ecriture_id INTEGER, updated_at TEXT);
    INSERT INTO ecritures VALUES
      ('E1','g1','recette',0,'vg_1','draft',NULL,'t'),
      ('E2','g1','recette',0,'vg_1','draft',NULL,'t');
  `);
  return db;
}

describe('correctGroupDraftType', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('recale le sens sur toutes les lignes du groupe', async () => {
    await correctGroupDraftType(testDb, 'g1', 'E1', 'vg_1', 'depense', 1);
    const rows = await testDb.prepare("SELECT type, justif_attendu FROM ecritures WHERE group_id='g1'").all<{ type: string; justif_attendu: number }>();
    expect(rows.every((r) => r.type === 'depense' && r.justif_attendu === 1)).toBe(true);
  });

  it('sans vg (ligne seule) ne touche que la ligne', async () => {
    await testDb.prepare("UPDATE ecritures SET ventilation_group_id = NULL WHERE id='E2'").run();
    await correctGroupDraftType(testDb, 'g1', 'E2', null, 'depense', 1);
    const e1 = await testDb.prepare("SELECT type FROM ecritures WHERE id='E1'").get<{ type: string }>();
    const e2 = await testDb.prepare("SELECT type FROM ecritures WHERE id='E2'").get<{ type: string }>();
    expect(e1?.type).toBe('recette'); // intacte
    expect(e2?.type).toBe('depense');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/scan-drafts-group-selfheal.test.ts`
Expected: FAIL — `correctGroupDraftType` non exporté.

- [ ] **Step 3: Write minimal implementation**

Dans `drafts.ts` :
1. Extraire un helper exporté (pur côté SQL, testable) :
   ```ts
   // Recale le sens (type) + justif_attendu sur TOUTES les lignes du groupe
   // de ventilation (self-heal). Sans vg → ne touche que `headId`. Ne touche
   // QUE type + justif_attendu (identité bancaire/imputation/liens intacts).
   export async function correctGroupDraftType(
     db: DbWrapper, groupId: string, headId: string, vg: string | null,
     type: 'depense' | 'recette', justifAttendu: number,
   ): Promise<void> {
     const ts = currentTimestamp();
     if (vg) {
       await db.prepare(
         `UPDATE ecritures SET type = ?, justif_attendu = ?, updated_at = ?
            WHERE group_id = ? AND ventilation_group_id = ? AND status = 'draft' AND comptaweb_ecriture_id IS NULL`,
       ).run(type, justifAttendu, ts, groupId, vg);
     } else {
       await db.prepare(
         `UPDATE ecritures SET type = ?, justif_attendu = ?, updated_at = ?
            WHERE id = ? AND group_id = ? AND status = 'draft' AND comptaweb_ecriture_id IS NULL`,
       ).run(type, justifAttendu, ts, headId, groupId);
     }
   }
   ```
2. Dans la boucle `scanDraftsFromComptaweb`, la branche `if (corrigeable && existingCand.type !== type)` : charger le `ventilation_group_id` de `existingCand` (ajouter la colonne au SELECT `existingRows`/`liveRows`) et remplacer l'appel `correctDraftType.run(...)` par :
   ```ts
   await correctGroupDraftType(getDb(), groupId, existingCand.id, existingCand.ventilationGroupId ?? null, type, justifAttendu);
   ```
   (Ajouter `ventilationGroupId` à la forme `liveRows` / au SELECT qui l'alimente.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/services/__tests__/scan-drafts-group-selfheal.test.ts`
Then: `cd web && pnpm vitest run src/lib/services/drafts-line-reconcile.test.ts` (garde-fou stale intact).
Expected: PASS ; aucune régression.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/drafts.ts web/src/lib/services/__tests__/scan-drafts-group-selfheal.test.ts
git commit -m "feat(ventilation): self-heal du sens sur tout le groupe au scan bancaire"
```

---

### Task 6: Composant `VentilationEditor` (modèle « défauts globaux + lignes légères »)

**Files:**
- Create: `web/src/components/ecritures/ventilation-editor.tsx`
- Test: `web/src/components/ecritures/__tests__/ventilation-editor.test.tsx`

**Interfaces:**
- Consumes: `DetailRow`, `DefaultImputation`, `resolveVentilations`, `editorRemainderCents`, `isMultiCategory`, `canSaveVentilation` (`./ventilate-editor-model`), `CategoryPicker` (`@/components/shared/category-picker`), `formatAmount` (`@/lib/format`), types `Category`, `Unite`, `Activite` (`@/lib/types`).
- Produces (props, utilisées par Task 7) :
  ```ts
  interface VentilationEditorProps {
    totalCents: number;              // total FIGÉ du groupe
    initialDefaults: DefaultImputation;
    initialRows: DetailRow[];        // ≥ 1 ligne (préremplie par le panneau)
    categories: Category[]; unites: Unite[]; activites: Activite[];
    onSave: (ventilations: ResolvedVentilation[]) => Promise<void>;
    saving?: boolean;
  }
  ```

**Comportement (spec 2026-07-13) :**
- Bloc « Imputation par défaut » : 2 `<select>` Activité + Unité. Les changer applique aux lignes **non surchargées**.
- Chaque ligne : Montant (`input`) + Nature (`CategoryPicker`) + bouton `⚙` (toggle surcharge activité/unité de CETTE ligne) + `✕` (retirer). Une ligne surchargée affiche ses 2 `<select>`.
- Lien « + Ajouter un détail » ajoute une ligne (montant vide, hérite du défaut).
- Indicateur : `✓ {formatAmount(total)} — équilibré` (vert) si `editorRemainderCents === 0`, sinon `reste {formatAmount(reste)} à ventiler` (ambre).
- Bouton « Enregistrer la ventilation » : `disabled` sauf si `canSaveVentilation(...)` et pas `saving`. Au clic → `onSave(resolveVentilations(defaults, rows))`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/ecritures/__tests__/ventilation-editor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VentilationEditor } from '../ventilation-editor';

const cats = [{ id: 'c-int', name: 'Intendance', comptaweb_nature: null }, { id: 'c-ph', name: 'Pharmacie', comptaweb_nature: null }] as never[];
const unites = [{ id: 'u-farfa', name: 'Farfadets' }] as never[];
const activites = [{ id: 'a-camps', name: 'Camps' }] as never[];

function renderEditor(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <VentilationEditor
      totalCents={1064}
      initialDefaults={{ unite_id: 'u-farfa', activite_id: 'a-camps' }}
      initialRows={[{ id: 'r1', amount: '10,64', category_id: 'c-int', override: null }]}
      categories={cats} unites={unites} activites={activites}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('VentilationEditor', () => {
  it('affiche le total équilibré au départ (1 ligne = total)', () => {
    renderEditor();
    expect(screen.getByText(/équilibré/i)).toBeTruthy();
  });

  it('« + Ajouter un détail » crée une ligne et déséquilibre → bouton désactivé', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    expect(screen.getByText(/à ventiler/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rééquilibrer + compléter → onSave reçoit les ventilations résolues', async () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    // ligne 1 → 7,00 ; ligne 2 → 3,64 + catégorie Pharmacie
    const amounts = screen.getAllByLabelText(/Montant/i);
    fireEvent.change(amounts[0], { target: { value: '7,00' } });
    fireEvent.change(amounts[1], { target: { value: '3,64' } });
    // Sélection de la catégorie de la 2ᵉ ligne (CategoryPicker expose un select en fallback / bouton)
    fireEvent.change(screen.getAllByLabelText(/Catégorie/i)[1], { target: { value: 'c-ph' } });
    const save = screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const arg = onSave.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg[0]).toMatchObject({ amount_cents: 700, category_id: 'c-int', unite_id: 'u-farfa', activite_id: 'a-camps' });
    expect(arg[1]).toMatchObject({ amount_cents: 364, category_id: 'c-ph' });
  });
});
```

> Le sélecteur exact de `CategoryPicker` dans le test doit être adapté à son API réelle (il expose un `onChange(value)` ; en environnement de test sans favoris il rend un `<select>` — cf. Task 7 S0 qui a corrigé ce fallback). Ajuster `getAllByLabelText(/Catégorie/i)` au rendu réel.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/ecritures/__tests__/ventilation-editor.test.tsx`
Expected: FAIL — composant inexistant.

- [ ] **Step 3: Write minimal implementation**

Composant client contrôlé s'appuyant sur `ventilate-editor-model`. État local : `defaults: DefaultImputation`, `rows: DetailRow[]`. Rendu :
- Bloc défaut : `<select>` Activité (options `activites`), `<select>` Unité (options `unites`). `onChange` → met à jour `defaults` **et** propage aux lignes dont `override === null` (rien à faire : elles héritent au moment de `resolveVentilations`, donc juste `setDefaults`).
- `rows.map` → pour chaque ligne : `<input aria-label="Montant">` (valeur `row.amount`), `<CategoryPicker aria-label="Catégorie" onChange={v => update(row.id,{category_id:v})}>`, bouton `⚙` (toggle `override` entre `null` et `{...defaults}`), si `override` non-null 2 `<select>` activité/unité pilotant `row.override`, bouton `✕` (retire la ligne ; interdit si une seule ligne).
- Lien « + Ajouter un détail » → `setRows([...rows, { id: crypto.randomUUID(), amount: '', category_id: null, override: null }])`.
- Indicateur solde via `editorRemainderCents(totalCents, rows)` + `formatAmount`.
- Bandeau catégorie « Catégories multiples » : exposer via prop de rendu ou laisser le panneau (Task 7) lire `isMultiCategory`. Ici, afficher un libellé d'en-tête `Catégories multiples` si `isMultiCategory(rows)`.
- Bouton « Enregistrer la ventilation » `disabled={!canSaveVentilation(totalCents, defaults, rows) || saving}` → `onSave(resolveVentilations(defaults, rows))`.

Utiliser `crypto.randomUUID()` (dispo navigateur ; en test jsdom, fournir un fallback compteur si absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/ecritures/__tests__/ventilation-editor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ecritures/ventilation-editor.tsx web/src/components/ecritures/__tests__/ventilation-editor.test.tsx
git commit -m "feat(ventilation): composant VentilationEditor (défauts globaux + lignes légères)"
```

---

### Task 7: Brancher l'éditeur dans le panneau + affichage groupé des drafts

**Files:**
- Modify: `web/src/components/ecritures/ecriture-inline-panel.tsx`
- Modify (si besoin): `web/src/lib/actions/ecritures.ts` (action serveur `ventilateEcriture` appelant l'endpoint/le service) OU appel `fetch` direct vers `/api/ecritures/[id]/ventilations`.
- Test: `web/src/components/ecritures/__tests__/panel-ventilation-wiring.test.tsx` (créer, ciblé)

**Interfaces:**
- Consumes: `VentilationEditor` (Task 6), `buildEcritureGroups` (`./ecriture-groups`, déjà groupe par `ventilation_group_id`), le endpoint Task 3.
- Le panneau, sur un draft éditable (`panelViewModel().editable && status==='draft' && comptaweb_ecriture_id===null`), affiche un lien **« + Ajouter un détail »**. Au 1ᵉʳ clic → bascule en mode ventilé : rend `<VentilationEditor>` prérempli :
  - `totalCents` = total du groupe (Σ des lignes du groupe, ou montant de l'écriture si mono).
  - `initialRows` = 1 ligne par membre du groupe (montant `formatAmount`, `category_id`, `override` = `{unite_id, activite_id}` si diffère du défaut choisi, sinon `null`).
  - `initialDefaults` = unité/activité de la tête.
  - `onSave` → `PUT /api/ecritures/[id]/ventilations` avec `{ ventilations }`, puis `router.refresh()` (ou le mécanisme de refresh de ligne existant `refreshRow`).

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/ecritures/__tests__/panel-ventilation-wiring.test.tsx
// Test ciblé : sur un draft, le panneau montre « + Ajouter un détail » et
// bascule vers l'éditeur au clic. (Le POST est mocké.)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// NB: importer EcritureInlinePanel avec les mocks nécessaires (actions, next/navigation).
// Ce squelette valide le trigger ; l'implémenteur complète le harnais de mock
// selon les dépendances réelles du panneau.

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// … (mocks des actions serveur importées par le panneau) …

describe('panneau — trigger ventilation', () => {
  it.todo('affiche « + Ajouter un détail » sur un draft éditable');
  it.todo('bascule vers VentilationEditor au clic et POST au save');
});
```

> Task 7 est une **tâche d'intégration** : le harnais de mock du panneau dépend de ses imports réels (actions serveur, `computeReadiness`, etc.). L'implémenteur doit d'abord lire `ecriture-inline-panel.tsx` en entier, écrire un test ciblé réel (remplacer les `it.todo`), le voir échouer, puis brancher. Ne PAS livrer avec des `it.todo`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/ecritures/__tests__/panel-ventilation-wiring.test.tsx`
Expected: le test réel (une fois écrit) échoue car le trigger n'existe pas encore.

- [ ] **Step 3: Write minimal implementation**

1. Dans `ecriture-inline-panel.tsx`, calculer `canVentilate = editable && ecriture.status === 'draft' && ecriture.comptaweb_ecriture_id === null`.
2. Ajouter un état `mode: 'simple' | 'ventile'`. En `simple`, sous l'imputation, rendre le lien « + Ajouter un détail » (si `canVentilate`). Au clic → `setMode('ventile')` en préremplissant l'état de l'éditeur à partir du groupe courant.
3. Récupérer les membres du groupe : le panneau reçoit déjà la liste d'écritures (via `buildEcritureGroups` en amont) — passer au panneau les membres du groupe (`groupEntries`) en prop, ou charger via une action. Préremplir `initialRows`.
4. `onSave` → `await fetch(\`/api/ecritures/\${headId}/ventilations\`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({ ventilations }) })` ; si `!res.ok` afficher l'erreur (message renvoyé) ; sinon `router.refresh()` et repasser en `simple`.
5. Quand `isMultiCategory` (≥ 2 membres), le bandeau catégorie affiche « Catégories multiples » (non éditable inline) au lieu du `CategoryPicker` de ligne.

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm vitest run src/components/ecritures/` (toute la suite écritures)
Then: `cd web && pnpm vitest run` (suite complète) + `cd web && pnpm build` (garde-fou Next 16 : pas de régression `'use server'` / `force-dynamic`).
Expected: PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ecritures/ecriture-inline-panel.tsx web/src/lib/actions/ecritures.ts web/src/components/ecritures/__tests__/panel-ventilation-wiring.test.tsx
git commit -m "feat(ventilation): éditeur de ventilation branché dans le panneau + affichage groupé des drafts"
```

---

## Notes d'exécution

- **Ordre** : Tasks 1→7 en séquence (dépendances linéaires : 6 consomme 1, 7 consomme 3+6).
- **Cas mono-ventilation intact** : toute la plomberie (`syncDraftToComptaweb`, scan) doit rester identique quand `ventilation_group_id IS NULL`. Chaque tâche backend inclut un test de non-régression implicite via la suite drafts existante.
- **Risque connu hérité de S0** (ventilations à montant égal → appariement sync non déterministe) : documenté dans la spec, NON traité ici. Ne pas chercher à le corriger dans ce plan.
- **Smoke test réel CW** (hors plan, action Benoît) : ventiler un draft bancaire réel en 2 catégories, « Faire dans CW », vérifier 1 pièce CW à 2 ventilations puis `sync_run` → mirror sans doublon.
- **Pas de `git push`** sans accord explicite.
