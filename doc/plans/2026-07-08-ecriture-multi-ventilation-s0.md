# Écriture multi-ventilation (S0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à une écriture Baloo de porter N ventilations (N catégories → 1 pièce Comptaweb), avec une UI de saisie de bout en bout sur `/ecritures/nouveau`.

**Architecture:** Le grain canonique reste la ventilation = N lignes `ecritures` reliées par une nouvelle colonne locale `ventilation_group_id`. Le payload de création passe à un tableau `ventilations[]`, l'adapter CW (qui bridait à 1 ventilation) est débridé — le POST bas niveau supporte déjà N ventilations. Le service create-and-push crée N lignes groupées avec transitions d'état atomiques, l'affichage les regroupe sous un header, et le wizard devient un répéteur avec compteur « reste à ventiler ».

**Tech Stack:** Next.js 16 (App Router), TypeScript, libsql/Turso, vitest, Zod, React client components.

## Global Constraints

- **JAMAIS de DELETE** sur `ecritures` (règle CLAUDE.md) : transitions par UPDATE uniquement, y compris le rollback groupé.
- **Grain canonique = ventilation** (ADR-035) : 1 ligne `ecritures` = 1 catégorie. Ne pas créer d'écriture agrégée.
- **libsql** : `ALTER TABLE ADD COLUMN` nullable (jamais `NOT NULL DEFAULT` en ALTER), dans `auth/schema.ts` ; `CREATE INDEX` **après** l'ALTER dans le même fichier ; définition complète aussi au `CREATE TABLE` de `business-schema.ts`.
- **Montants en centimes** partout en BDD ; format FR `"42,50"` en UI.
- **Invariant dur** : Σ des `amount_cents` des ventilations = `amount_cents` total de l'en-tête.
- **Terminologie** : « ventilation » (pas « répartition » — déjà pris par `repartitions_unites`).
- **Rétro-compat** : une saisie mono-catégorie = 1 ventilation, `ventilation_group_id = null`, comportement inchangé.

---

## File Structure

- `web/src/lib/db/business-schema.ts` — ajoute `ventilation_group_id` au `CREATE TABLE ecritures`.
- `web/src/lib/auth/schema.ts` — migration `ALTER ADD COLUMN` + `CREATE INDEX`.
- `web/src/lib/types.ts` — champ `ventilation_group_id` sur `interface Ecriture`.
- `web/src/lib/services/ecritures-create.ts` — `VentilationInput`, `EcriturePayload` (ventilations[]), N INSERT groupés + transitions atomiques.
- `web/src/lib/services/ecritures-create-cw-adapter.ts` — débridage `buildCwInputFromPayload` (N ventilations, mapping par ligne).
- `web/src/app/api/ecritures/route.ts` — `createSchema` avec `ventilations[]` + validation somme.
- `web/src/components/ecritures/ecriture-groups.ts` — **nouveau** : fonction pure `buildEcritureGroups` (extraction de la logique de grouping, testable), avec la 3ᵉ clé `ventil`.
- `web/src/components/ecritures/ecritures-table.tsx` — consomme `buildEcritureGroups`, style du groupe `ventil`.
- `web/src/components/ecritures/nouvelle-ecriture-wizard.tsx` — payload multi-ventilations.
- `web/src/components/ecritures/ecriture-form.tsx` — répéteur de ventilations + « reste à ventiler ».
- Tests : `__tests__/` à côté de chaque service ; `ecriture-groups.test.ts` pour le grouping.

---

### Task 1 : Migration BDD — colonne `ventilation_group_id`

**Files:**
- Modify: `web/src/lib/db/business-schema.ts` (bloc `ECRITURES_COLUMNS_DDL`, ~ligne 20-64)
- Modify: `web/src/lib/auth/schema.ts` (zone des `ALTER TABLE ecritures` + index)
- Modify: `web/src/lib/types.ts:61-78` (`interface Ecriture`)
- Test: `web/src/lib/db/__tests__/ventilation-group-migration.test.ts` (create)

**Interfaces:**
- Produces: colonne `ecritures.ventilation_group_id TEXT` (nullable) ; champ TS `Ecriture.ventilation_group_id: string | null`.

- [ ] **Step 1: Écrire le test de migration (échoue)**

Create `web/src/lib/db/__tests__/ventilation-group-migration.test.ts` :

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureBusinessSchema } from '../business-schema';

let db: DbWrapper;

describe('migration ventilation_group_id', () => {
  beforeEach(() => {
    const client = createClient({ url: 'file::memory:' });
    db = wrapClient(client);
  });

  it('la colonne ventilation_group_id existe sur ecritures et accepte NULL + une valeur', async () => {
    await ensureBusinessSchema(db);
    // INSERT minimal avec la colonne renseignée
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, ventilation_group_id)
       VALUES ('ECR-1', 'g', '2026-07-08', 'test', 1000, 'depense', 'draft', 'vg_abc')`,
    ).run();
    const row = await db.prepare('SELECT ventilation_group_id FROM ecritures WHERE id = ?')
      .get<{ ventilation_group_id: string | null }>('ECR-1');
    expect(row?.ventilation_group_id).toBe('vg_abc');
  });
});
```

> Note : `ensureBusinessSchema` prend le `db` en paramètre optionnel dans ce codebase (cf. autres tests du dossier). Si la signature réelle diffère, adapter l'appel (certaines versions lisent `getDb()` — dans ce cas mocker `../../db` comme dans `depots-update.test.ts`).

- [ ] **Step 2: Lancer le test (doit échouer)**

Run: `cd web && npx vitest run src/lib/db/__tests__/ventilation-group-migration.test.ts`
Expected: FAIL — `table ecritures has no column named ventilation_group_id`.

- [ ] **Step 3: Ajouter la colonne au CREATE TABLE**

Dans `business-schema.ts`, bloc `ECRITURES_COLUMNS_DDL`, ajouter après `comptaweb_ecriture_id INTEGER,` :

```sql
      ventilation_group_id TEXT,
```

- [ ] **Step 4: Ajouter la migration ALTER + index dans auth/schema.ts**

Dans `auth/schema.ts`, à la suite des autres `ALTER TABLE ecritures ADD COLUMN` (chercher un `try { await db.exec('ALTER TABLE ecritures ADD COLUMN ...') } catch {}` existant et suivre le même pattern idempotent) :

```typescript
  // Multi-ventilation (S0, 2026-07-08) : relie N lignes ecritures d'une
  // même pièce AVANT que comptaweb_ecriture_id soit connu. Nullable
  // (mono-catégorie = null). Cf. doc/specs/2026-07-08-ecriture-multi-ventilation-design.md
  try { await db.exec('ALTER TABLE ecritures ADD COLUMN ventilation_group_id TEXT'); } catch { /* déjà présent */ }
  try { await db.exec('CREATE INDEX IF NOT EXISTS idx_ecritures_ventilation_group ON ecritures(ventilation_group_id)'); } catch { /* déjà présent */ }
```

- [ ] **Step 5: Ajouter le champ au type Ecriture**

Dans `types.ts`, dans `interface Ecriture`, après `comptaweb_ecriture_id: number | null;` :

```typescript
  ventilation_group_id: string | null;
```

- [ ] **Step 6: Lancer le test (doit passer)**

Run: `cd web && npx vitest run src/lib/db/__tests__/ventilation-group-migration.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: aucune erreur (ou uniquement des erreurs à corriger dans les tâches suivantes si `Ecriture` est construit sans ce champ — dans ce cas, corriger les constructeurs concernés en posant `ventilation_group_id: null`).

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/db/business-schema.ts web/src/lib/auth/schema.ts web/src/lib/types.ts web/src/lib/db/__tests__/ventilation-group-migration.test.ts
git commit -m "feat(ecritures): colonne ventilation_group_id (S0 multi-ventilation)"
```

---

### Task 2 : `EcriturePayload` → `ventilations[]`

**Files:**
- Modify: `web/src/lib/services/ecritures-create.ts:70-83` (types)
- Test: `web/src/lib/services/__tests__/ecritures-create-ventilations.test.ts` (create) — testé indirectement via Task 4 ; ici on ne teste que le type via compilation.

**Interfaces:**
- Produces:
  ```typescript
  export interface VentilationInput {
    amount_cents: number;
    category_id?: string | null;
    unite_id?: string | null;
    activite_id?: string | null;
  }
  export interface EcriturePayload {
    date_ecriture: string;      // ISO YYYY-MM-DD
    description: string;
    amount_cents: number;       // TOTAL (= Σ ventilations)
    type: 'depense' | 'recette';
    mode_paiement_id?: string | null;
    numero_piece?: string | null;
    carte_id?: string | null;
    notes?: string | null;
    justif_attendu?: 0 | 1 | boolean;
    ventilations: VentilationInput[];
  }
  ```
- Consumes (Task 3, 4, 5) : cette forme.

- [ ] **Step 1: Remplacer l'interface `EcriturePayload`**

Dans `ecritures-create.ts`, remplacer le bloc `export interface EcriturePayload { ... }` (lignes 70-83) par les deux interfaces ci-dessus (`VentilationInput` + `EcriturePayload`). Retirer les champs scalaires `category_id` / `unite_id` / `activite_id` au niveau racine (ils vivent désormais dans `ventilations[]`).

- [ ] **Step 2: Typecheck (échec attendu — les consommateurs cassent)**

Run: `cd web && npx tsc --noEmit`
Expected: FAIL dans `ecritures-create.ts` (INSERT mono-cat), `ecritures-create-cw-adapter.ts`, `route.ts`. **C'est normal** — ces erreurs sont réparées Tasks 3, 4, 5. Ne pas les corriger ici.

- [ ] **Step 3: Commit (WIP compilable après Task 5)**

> Ce commit laisse volontairement le build rouge jusqu'à Task 5. Si tu préfères un arbre toujours vert, **fusionne Tasks 2→5 en un seul commit** à la fin de Task 5. Recommandé : garder les tâches séparées pour la revue, committer à la fin de Task 5.

Ne pas committer seul. Enchaîner Task 3.

---

### Task 3 : Débridage de l'adapter CW (`buildCwInputFromPayload`)

**Files:**
- Modify: `web/src/lib/services/ecritures-create-cw-adapter.ts:95-157` + commentaire `:26-29`
- Test: `web/src/lib/services/__tests__/ecritures-create-cw-adapter.test.ts` (fichier existant — ajouter des cas)

**Interfaces:**
- Consumes: `EcriturePayload` (Task 2), `VentilationInput`.
- Produces: `buildCwInputFromPayload(payload, deps)` retourne un `CreateEcritureInput` avec `ventilations` de longueur = `payload.ventilations.length`.

- [ ] **Step 1: Écrire les tests (échouent)**

Ajouter dans `ecritures-create-cw-adapter.test.ts` (adapter le mock `lookupComptawebId` déjà présent dans ce fichier — il mappe un id Baloo → comptaweb_id) :

```typescript
it('mappe N ventilations vers N lignes CW', async () => {
  const input = await buildCwInputFromPayload(
    {
      date_ecriture: '2026-07-08', description: 'Courses camp', amount_cents: 10000,
      type: 'depense', mode_paiement_id: 'MODE-CB',
      ventilations: [
        { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
        { amount_cents: 3000, category_id: 'CAT-MAT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      ],
    },
    fakeDeps, // lookupComptawebId renvoie un number pour chaque id, lookupCarte -> null
  );
  expect(input.ventilations).toHaveLength(2);
  expect(input.ventilations[0].montant).toBe('70,00');
  expect(input.ventilations[1].montant).toBe('30,00');
});

it('refuse si la somme des ventilations ≠ montant total', async () => {
  await expect(buildCwInputFromPayload(
    {
      date_ecriture: '2026-07-08', description: 'x', amount_cents: 10000, type: 'depense',
      mode_paiement_id: 'MODE-CB',
      ventilations: [{ amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' }],
    },
    fakeDeps,
  )).rejects.toThrow(/somme/i);
});

it('erreur claire quand un mapping CW manque sur une ligne précise', async () => {
  await expect(buildCwInputFromPayload(
    {
      date_ecriture: '2026-07-08', description: 'x', amount_cents: 10000, type: 'depense',
      mode_paiement_id: 'MODE-CB',
      ventilations: [
        { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
        { amount_cents: 3000, category_id: 'CAT-SANS-MAP', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      ],
    },
    { ...fakeDeps, lookupComptawebId: async (t, id) => (id === 'CAT-SANS-MAP' ? null : 1) },
  )).rejects.toThrow(/ventilation 2/i);
});
```

> `fakeDeps` : reprendre le style du fichier existant (`{ lookupComptawebId: async () => <number>, lookupCarte: async () => null }`). Vérifier le nom exact des overrides dans `ResolveDeps` (`:77-87`).

- [ ] **Step 2: Lancer (doit échouer)**

Run: `cd web && npx vitest run src/lib/services/__tests__/ecritures-create-cw-adapter.test.ts`
Expected: FAIL (une seule ventilation aujourd'hui / pas de validation somme).

- [ ] **Step 3: Débrider `buildCwInputFromPayload`**

Remplacer la résolution mono-ligne (lignes 102-124 + le `ventilations: [{…}]` 148-155) par une résolution par ligne. Le mode de paiement / carte restent au niveau en-tête. Nouveau cœur :

```typescript
export async function buildCwInputFromPayload(
  payload: EcriturePayload,
  deps: ResolveDeps = {},
): Promise<CreateEcritureInput> {
  const luComptawebId = deps.lookupComptawebId ?? lookupComptawebId;
  const luCarte = deps.lookupCarte ?? lookupCarte;

  // En-tête : mode de paiement (obligatoire pour CW)
  const modeCw = await luComptawebId('modes_paiement', payload.mode_paiement_id);
  if (!payload.mode_paiement_id) throw new Error('Il manque : mode de paiement.');
  if (modeCw === null) throw new Error('Il manque : mapping CW du mode de paiement.');

  // Invariant somme = total
  const sum = payload.ventilations.reduce((s, v) => s + v.amount_cents, 0);
  if (sum !== payload.amount_cents) {
    throw new Error(
      `La somme des ventilations (${centsToMontantFr(sum)}) ne correspond pas au montant total (${centsToMontantFr(payload.amount_cents)}).`,
    );
  }
  if (payload.ventilations.length === 0) throw new Error('Au moins une ventilation est requise.');

  // Résolution par ligne
  const ventilations = [];
  for (let i = 0; i < payload.ventilations.length; i++) {
    const v = payload.ventilations[i];
    const [natureCw, activiteCw, uniteCw] = await Promise.all([
      luComptawebId('categories', v.category_id),
      luComptawebId('activites', v.activite_id),
      luComptawebId('unites', v.unite_id),
    ]);
    const missing: string[] = [];
    if (!v.category_id) missing.push('catégorie');
    else if (natureCw === null) missing.push('mapping CW de la catégorie');
    if (!v.activite_id) missing.push('activité');
    else if (activiteCw === null) missing.push("mapping CW de l'activité");
    if (!v.unite_id) missing.push('unité');
    else if (uniteCw === null) missing.push("mapping CW de l'unité");
    if (missing.length > 0) {
      throw new Error(
        `Ventilation ${i + 1} — il manque : ${missing.join(', ')}. ` +
        `Mappe les référentiels (page Sync référentiels) ou utilise "Tout copier".`,
      );
    }
    ventilations.push({
      montant: centsToMontantFr(v.amount_cents),
      natureId: String(natureCw),
      activiteId: String(activiteCw),
      brancheprojetId: String(uniteCw),
    });
  }

  const carte = await luCarte(payload.carte_id);
  const cartebancaireId = carte?.type === 'cb' && carte.comptaweb_id ? String(carte.comptaweb_id) : undefined;
  const carteprocurementId = carte?.type === 'procurement' && carte.comptaweb_id ? String(carte.comptaweb_id) : undefined;

  return {
    type: payload.type,
    libel: payload.description,
    dateecriture: isoToFr(payload.date_ecriture),
    montant: centsToMontantFr(payload.amount_cents),
    numeropiece: payload.numero_piece ?? undefined,
    modetransactionId: String(modeCw),
    comptebancaireId: DEFAULT_COMPTE_BANCAIRE_ID,
    cartebancaireId,
    carteprocurementId,
    tiersCategId: DEFAULT_TIERS_CATEG_ID,
    tiersStructureId: DEFAULT_TIERS_STRUCTURE_ID,
    ventilations,
  };
}
```

Remplacer le commentaire de bridage (`:26-29`) par : `//  - **Multi-ventilation supporté** : N lignes Baloo → N ventilations CW (S0, 2026-07-08).`

- [ ] **Step 4: Lancer (doit passer)**

Run: `cd web && npx vitest run src/lib/services/__tests__/ecritures-create-cw-adapter.test.ts`
Expected: PASS (y compris les cas existants mono-ventilation, qui restent valides avec une ventilation à 1 élément).

---

### Task 4 : Service create-and-push — N lignes groupées + transitions atomiques

**Files:**
- Modify: `web/src/lib/services/ecritures-create.ts:125-272`
- Test: `web/src/lib/services/__tests__/ecritures-create.test.ts` (fichier existant — ajouter des cas)

**Interfaces:**
- Consumes: `EcriturePayload` (Task 2).
- Produces: `createEcritureAndPushToCw` inchangé de signature (`CreateEcritureAndPushToCwResult { id, status, cw_numero_piece }`) où `id` = id de la **1ʳᵉ** ligne du groupe.

- [ ] **Step 1: Écrire les tests (échouent)**

Ajouter dans `ecritures-create.test.ts` (reprendre le setup DB in-memory + fakeScraper du fichier) :

```typescript
it('crée N lignes ecritures partageant un ventilation_group_id (succès CW)', async () => {
  const res = await createEcritureAndPushToCw(db, {
    group_id: 'g',
    payload: {
      date_ecriture: '2026-07-08', description: 'Courses camp', amount_cents: 10000, type: 'depense',
      mode_paiement_id: 'MODE-CB',
      ventilations: [
        { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
        { amount_cents: 3000, category_id: 'CAT-MAT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      ],
    },
    cwScraper: async () => ({ cwNumeroPiece: '999', cwEcritureId: 999 }),
    cwConfigLoader: async () => ({} as never),
  });
  expect(res.status).toBe('pending_sync');
  const rows = await db.prepare(
    `SELECT ventilation_group_id, status, cw_numero_piece, amount_cents, category_id
     FROM ecritures WHERE group_id = 'g' ORDER BY amount_cents DESC`,
  ).all<{ ventilation_group_id: string; status: string; cw_numero_piece: string; amount_cents: number; category_id: string }>();
  expect(rows).toHaveLength(2);
  expect(rows[0].ventilation_group_id).toBe(rows[1].ventilation_group_id);
  expect(rows[0].ventilation_group_id).toMatch(/^vg_/);
  expect(rows.every(r => r.status === 'pending_sync')).toBe(true);
  expect(rows.every(r => r.cw_numero_piece === '999')).toBe(true);
  expect(rows.map(r => r.amount_cents)).toEqual([7000, 3000]);
});

it('mono-catégorie : ventilation_group_id reste null', async () => {
  await createEcritureAndPushToCw(db, {
    group_id: 'g',
    payload: {
      date_ecriture: '2026-07-08', description: 'x', amount_cents: 5000, type: 'depense',
      mode_paiement_id: 'MODE-CB',
      ventilations: [{ amount_cents: 5000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' }],
    },
    cwScraper: async () => ({ cwNumeroPiece: '1', cwEcritureId: 1 }),
    cwConfigLoader: async () => ({} as never),
  });
  const row = await db.prepare(`SELECT ventilation_group_id FROM ecritures WHERE group_id='g'`)
    .get<{ ventilation_group_id: string | null }>();
  expect(row?.ventilation_group_id).toBeNull();
});

it('échec CW : les N lignes retombent toutes en draft (aucun DELETE)', async () => {
  await expect(createEcritureAndPushToCw(db, {
    group_id: 'g',
    payload: {
      date_ecriture: '2026-07-08', description: 'x', amount_cents: 10000, type: 'depense',
      mode_paiement_id: 'MODE-CB',
      ventilations: [
        { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
        { amount_cents: 3000, category_id: 'CAT-MAT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      ],
    },
    cwScraper: async () => { throw new Error('CW down'); },
    cwConfigLoader: async () => ({} as never),
  })).rejects.toThrow();
  const rows = await db.prepare(`SELECT status FROM ecritures WHERE group_id='g'`).all<{ status: string }>();
  expect(rows).toHaveLength(2);
  expect(rows.every(r => r.status === 'draft')).toBe(true);
});
```

> Adapter le setup (CREATE TABLE ecritures avec la colonne `ventilation_group_id`, mock de `../../ids` si le fichier le fait déjà). Reprendre exactement le harnais du fichier existant.

- [ ] **Step 2: Lancer (doit échouer)**

Run: `cd web && npx vitest run src/lib/services/__tests__/ecritures-create.test.ts`
Expected: FAIL (INSERT mono-cat, pas de group_id).

- [ ] **Step 3: Réécrire `createEcritureAndPushToCw`**

Remplacer le corps (INSERT unique + UPDATE) par : génération conditionnelle du group id, boucle d'INSERT, transitions groupées. Points clés :

```typescript
import { randomUUID } from 'node:crypto';
// ...
export async function createEcritureAndPushToCw(
  db: DbWrapper,
  opts: CreateEcritureAndPushToCwOpts,
): Promise<CreateEcritureAndPushToCwResult> {
  const { payload, group_id } = opts;
  const prefix = payload.type === 'depense' ? 'DEP' : 'REC';
  const now = currentTimestamp();
  const justifAttendu = payload.justif_attendu === undefined
    ? (payload.type === 'recette' ? 0 : 1)
    : (payload.justif_attendu ? 1 : 0);

  const vents = payload.ventilations;
  if (!vents || vents.length === 0) throw new Error('Au moins une ventilation est requise.');
  const sum = vents.reduce((s, v) => s + v.amount_cents, 0);
  if (sum !== payload.amount_cents) {
    throw new Error(`Somme des ventilations ≠ montant total (${sum} vs ${payload.amount_cents}).`);
  }

  // group id local UNIQUEMENT si ≥ 2 ventilations
  const groupId = vents.length >= 2 ? `vg_${randomUUID()}` : null;

  // 1. N INSERT en pending_cw, tous au même ventilation_group_id
  const ids: string[] = [];
  for (const v of vents) {
    const id = await nextIdOn(db, prefix);
    ids.push(id);
    await db.prepare(
      `INSERT INTO ecritures (
        id, group_id, date_ecriture, description, amount_cents, type,
        unite_id, category_id, mode_paiement_id, activite_id, numero_piece,
        carte_id, justif_attendu, notes, ventilation_group_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_cw', ?, ?)`,
    ).run(
      id, group_id, payload.date_ecriture, payload.description, v.amount_cents, payload.type,
      nullIfEmpty(v.unite_id ?? null), nullIfEmpty(v.category_id ?? null),
      nullIfEmpty(payload.mode_paiement_id ?? null), nullIfEmpty(v.activite_id ?? null),
      nullIfEmpty(payload.numero_piece ?? null), nullIfEmpty(payload.carte_id ?? null),
      justifAttendu, nullIfEmpty(payload.notes ?? null), groupId, now, now,
    );
  }
  const firstId = ids[0];

  // Garde-fous d'injection (inchangés) : rollback des N si scraper/loader absent
  if (!opts.cwScraper) { await rollbackGroupToDraft(db, ids, group_id); throw new CwPushFailedError(firstId, new Error('cwScraper non fourni.')); }
  if (!opts.cwConfigLoader) { await rollbackGroupToDraft(db, ids, group_id); throw new CwPushFailedError(firstId, new Error('cwConfigLoader non fourni.')); }

  // 2. Un seul POST CW
  let cwResult: CwScraperResult;
  try {
    const config = await opts.cwConfigLoader();
    cwResult = await opts.cwScraper(config, payload);
  } catch (err) {
    await rollbackGroupToDraft(db, ids, group_id);
    throw new CwPushFailedError(firstId, err);
  }

  // 3. Succès : UPDATE des N lignes en pending_sync (même cw_numero_piece / comptaweb_ecriture_id)
  try {
    for (const id of ids) {
      await db.prepare(
        `UPDATE ecritures SET status='pending_sync', cw_numero_piece=?,
           comptaweb_ecriture_id=COALESCE(?, comptaweb_ecriture_id), updated_at=?
         WHERE id=? AND group_id=?`,
      ).run(cwResult.cwNumeroPiece, cwResult.cwEcritureId ?? null, currentTimestamp(), id, group_id);
    }
  } catch (err) {
    console.error('[ecritures-create] CW push OK but local UPDATE failed', { ids, cw_numero_piece: cwResult.cwNumeroPiece, error: err });
    throw new CwLocalUpdateFailedError(firstId, cwResult.cwNumeroPiece, err);
  }

  return { id: firstId, status: 'pending_sync', cw_numero_piece: cwResult.cwNumeroPiece };
}

async function rollbackGroupToDraft(db: DbWrapper, ids: string[], group_id: string): Promise<void> {
  for (const id of ids) {
    await db.prepare(`UPDATE ecritures SET status='draft', updated_at=? WHERE id=? AND group_id=?`)
      .run(currentTimestamp(), id, group_id);
  }
}
```

Supprimer l'ancienne `rollbackToDraft` (remplacée par `rollbackGroupToDraft`).

- [ ] **Step 4: Lancer (doit passer)**

Run: `cd web && npx vitest run src/lib/services/__tests__/ecritures-create.test.ts`
Expected: PASS.

---

### Task 5 : Route `/api/ecritures` — schema multi-ventilations

**Files:**
- Modify: `web/src/app/api/ecritures/route.ts:66-79` (`createSchema`) + construction du payload
- Test: `web/src/app/api/__tests__/ecritures-route-schema.test.ts` (create) — teste le schema Zod isolément

**Interfaces:**
- Consumes: `createEcritureAndPushToCw` (Task 4), `EcriturePayload` (Task 2).
- Produces: la route accepte un body `{ ...header, ventilations: [{ amount_cents, category_id?, unite_id?, activite_id? }] }`.

- [ ] **Step 1: Écrire le test du schema (échoue)**

Create `web/src/app/api/__tests__/ecritures-route-schema.test.ts`. Extraire `createSchema` dans un export nommé pour le tester (Step 3), puis :

```typescript
import { describe, it, expect } from 'vitest';
import { createSchema } from '../ecritures/route';

const base = {
  date_ecriture: '2026-07-08', description: 'x', amount_cents: 10000, type: 'depense',
  mode_paiement_id: 'MODE-CB',
};

describe('createSchema (route ecritures)', () => {
  it('accepte N ventilations dont la somme = total', () => {
    const r = createSchema.safeParse({ ...base, ventilations: [
      { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      { amount_cents: 3000, category_id: 'CAT-MAT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
    ]});
    expect(r.success).toBe(true);
  });
  it('rejette si la somme des ventilations ≠ amount_cents', () => {
    const r = createSchema.safeParse({ ...base, ventilations: [
      { amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
    ]});
    expect(r.success).toBe(false);
  });
  it('accepte une seule ventilation (mono-catégorie)', () => {
    const r = createSchema.safeParse({ ...base, amount_cents: 5000, ventilations: [
      { amount_cents: 5000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
    ]});
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer (doit échouer)**

Run: `cd web && npx vitest run src/app/api/__tests__/ecritures-route-schema.test.ts`
Expected: FAIL — `createSchema` non exporté / pas de champ `ventilations`.

- [ ] **Step 3: Réécrire `createSchema` (exporté) + payload**

Dans `route.ts`, remplacer `const createSchema = z.object({...})` par un export avec ventilations + refine somme :

```typescript
const ventilationSchema = z.object({
  amount_cents: z.number().int(),
  category_id: z.string().nullish(),
  unite_id: z.string().nullish(),
  activite_id: z.string().nullish(),
});

export const createSchema = z.object({
  date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount_cents: z.number().int(),
  type: z.enum(['depense', 'recette']),
  mode_paiement_id: z.string().nullish(),
  numero_piece: z.string().nullish(),
  carte_id: z.string().nullish(),
  justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  notes: z.string().nullish(),
  ventilations: z.array(ventilationSchema).min(1),
}).refine(
  (d) => d.ventilations.reduce((s, v) => s + v.amount_cents, 0) === d.amount_cents,
  { message: 'La somme des ventilations doit égaler le montant total.', path: ['ventilations'] },
);
```

Le `payload: EcriturePayload = parsed.data` fonctionne tel quel (formes alignées). Vérifier qu'aucun champ scalaire `category_id`/`unite_id`/`activite_id` racine ne subsiste dans le handler.

- [ ] **Step 4: Lancer (doit passer)**

Run: `cd web && npx vitest run src/app/api/__tests__/ecritures-route-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck global (doit être vert)**

Run: `cd web && npx tsc --noEmit`
Expected: aucune erreur — Tasks 2→5 se referment.

- [ ] **Step 6: Commit (backend multi-ventilation complet)**

```bash
git add web/src/lib/services/ecritures-create.ts web/src/lib/services/ecritures-create-cw-adapter.ts web/src/app/api/ecritures/route.ts web/src/lib/services/__tests__/ecritures-create.test.ts web/src/lib/services/__tests__/ecritures-create-cw-adapter.test.ts web/src/app/api/__tests__/ecritures-route-schema.test.ts
git commit -m "feat(ecritures): backend multi-ventilation (payload ventilations[], adapter débridé, N lignes groupées)"
```

---

### Task 6 : Affichage groupé — 3ᵉ clé `ventilation_group_id`

**Files:**
- Create: `web/src/components/ecritures/ecriture-groups.ts` (fonction pure extraite)
- Test: `web/src/components/ecritures/__tests__/ecriture-groups.test.ts` (create)
- Modify: `web/src/components/ecritures/ecritures-table.tsx:60-243` (utiliser la fonction pure + style `ventil`)

**Interfaces:**
- Produces:
  ```typescript
  export type GroupKind = 'bank' | 'cw' | 'ventil';
  export interface Group { kind: GroupKind; id: string; label: string; sublabel: string; totalCents: number; count: number; }
  export interface HeaderItem { kind: 'header'; group: Group; }
  export interface RowItem { kind: 'row'; ecriture: Ecriture; group: Group | null; }
  export type Item = HeaderItem | RowItem;
  export function buildEcritureGroups(rows: Ecriture[]): Item[];
  export function groupKey(kind: GroupKind, id: string): string;
  ```
- Consumes: `Ecriture` (Task 1 champ `ventilation_group_id`).

- [ ] **Step 1: Écrire le test du grouping (échoue)**

Create `web/src/components/ecritures/__tests__/ecriture-groups.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { buildEcritureGroups } from '../ecriture-groups';
import type { Ecriture } from '@/lib/types';

function ecr(over: Partial<Ecriture>): Ecriture {
  return {
    id: 'E', group_id: 'g', date_ecriture: '2026-07-08', description: 'x',
    amount_cents: 1000, type: 'depense', status: 'draft',
    ligne_bancaire_id: null, ligne_bancaire_sous_index: null, comptaweb_ecriture_id: null,
    ventilation_group_id: null,
    // compléter les autres champs obligatoires d'Ecriture avec des valeurs neutres
    ...over,
  } as Ecriture;
}

describe('buildEcritureGroups — clé ventilation_group_id', () => {
  it('≥2 lignes même ventilation_group_id → 1 header + N rows', () => {
    const items = buildEcritureGroups([
      ecr({ id: 'E1', amount_cents: 7000, ventilation_group_id: 'vg_1' }),
      ecr({ id: 'E2', amount_cents: 3000, ventilation_group_id: 'vg_1' }),
    ]);
    const headers = items.filter(i => i.kind === 'header');
    expect(headers).toHaveLength(1);
    expect(headers[0].kind === 'header' && headers[0].group.kind).toBe('ventil');
    expect(headers[0].kind === 'header' && headers[0].group.totalCents).toBe(10000);
    expect(items.filter(i => i.kind === 'row')).toHaveLength(2);
  });

  it('une seule ligne avec ventilation_group_id null → pas de header', () => {
    const items = buildEcritureGroups([ecr({ id: 'E1', ventilation_group_id: null })]);
    expect(items.filter(i => i.kind === 'header')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Lancer (doit échouer)**

Run: `cd web && npx vitest run src/components/ecritures/__tests__/ecriture-groups.test.ts`
Expected: FAIL — module `ecriture-groups` inexistant.

- [ ] **Step 3: Extraire la logique de grouping dans `ecriture-groups.ts`**

Créer `ecriture-groups.ts` en déplaçant la logique du `useMemo` (`ecritures-table.tsx:130-188`) dans une fonction pure `buildEcritureGroups(rows)`. Ajouter la 3ᵉ famille :
- 3ᵉ `Map` `byVentil` (clé `ventilation_group_id`).
- `isVentilGrouped = (id) => (byVentil.get(id)?.length ?? 0) >= 2`.
- Dans `groupFor(e)` : priorité `bank` > `cw` > `ventil`. Si `e.ventilation_group_id` et `isVentilGrouped`, renvoyer un `Group { kind:'ventil', id:e.ventilation_group_id, label:'Ventilation', sublabel:<date/libellé>, totalCents:<somme du groupe>, count:<n> }`.
- `groupKey(kind,id)` et la construction `Item[]` (header au 1er vu, puis row) : identiques à l'existant.

- [ ] **Step 4: Brancher le composant sur la fonction pure**

Dans `ecritures-table.tsx` : remplacer le corps du `useMemo` par `const items = useMemo(() => buildEcritureGroups(rows), [rows]);` (import depuis `./ecriture-groups`). Étendre `GROUP_STYLE` (`:80-93`) avec une entrée `ventil` (rail vertical + teinte de fond, ex. réutiliser la teinte `cw` ou une teinte dédiée). Généraliser les ternaires binaires `g.kind === 'bank' ? … : …` (`groupEntries`, `selectGroup`, `:230-243`) pour couvrir `'ventil'` (mapper vers la même branche que `'cw'` : regroupement logique local, pas bancaire).

- [ ] **Step 5: Lancer les tests + typecheck**

Run: `cd web && npx vitest run src/components/ecritures/__tests__/ecriture-groups.test.ts && npx tsc --noEmit`
Expected: PASS + 0 erreur.

- [ ] **Step 6: Lint + commit**

```bash
cd web && npx eslint src/components/ecritures/ecriture-groups.ts src/components/ecritures/ecritures-table.tsx
git add web/src/components/ecritures/ecriture-groups.ts web/src/components/ecritures/__tests__/ecriture-groups.test.ts web/src/components/ecritures/ecritures-table.tsx
git commit -m "feat(ecritures): regroupement d'affichage par ventilation_group_id"
```

---

### Task 7 : UI wizard `/ecritures/nouveau` — répéteur de ventilations

**Files:**
- Modify: `web/src/components/ecritures/ecriture-form.tsx` (`EcritureFormFields`)
- Modify: `web/src/components/ecritures/nouvelle-ecriture-wizard.tsx:39-60` (`readPayloadFromForm`) + `:97-110` (body)
- Test: `web/src/components/ecritures/__tests__/ventilations-form.test.ts` (create) — teste le helper pur de lecture des ventilations

**Interfaces:**
- Consumes: la route `/api/ecritures` (Task 5).
- Produces: le body POST contient `ventilations: [{ amount_cents, category_id, unite_id, activite_id }]`.

- [ ] **Step 1: Extraire + tester un helper pur de lecture des ventilations (échoue)**

Créer dans `nouvelle-ecriture-wizard.tsx` (ou un module voisin `ventilations-form.ts`) un helper pur :

```typescript
// ventilations-form.ts
import { parseAmount } from '@/lib/format';
export interface VentilationDraft { amount: string; category_id: string | null; unite_id: string | null; activite_id: string | null; }
export function ventilationsToPayload(rows: VentilationDraft[]): { amount_cents: number; category_id: string | null; unite_id: string | null; activite_id: string | null }[] {
  return rows.map(r => ({
    amount_cents: parseAmount(r.amount || '0'),
    category_id: r.category_id || null,
    unite_id: r.unite_id || null,
    activite_id: r.activite_id || null,
  }));
}
export function ventilationsRemainderCents(totalCents: number, rows: VentilationDraft[]): number {
  return totalCents - rows.reduce((s, r) => s + parseAmount(r.amount || '0'), 0);
}
```

Test `ventilations-form.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { ventilationsToPayload, ventilationsRemainderCents } from '../ventilations-form';

it('convertit les lignes en payload cents', () => {
  expect(ventilationsToPayload([{ amount: '70,00', category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' }]))
    .toEqual([{ amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' }]);
});
it('calcule le reste à ventiler', () => {
  expect(ventilationsRemainderCents(10000, [{ amount: '70,00', category_id: 'CAT-INT', unite_id: null, activite_id: null }])).toBe(3000);
});
```

- [ ] **Step 2: Lancer (doit échouer)**

Run: `cd web && npx vitest run src/components/ecritures/__tests__/ventilations-form.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3: Créer le helper**

Créer `web/src/components/ecritures/ventilations-form.ts` avec le code du Step 1.

- [ ] **Step 4: Lancer (doit passer)**

Run: `cd web && npx vitest run src/components/ecritures/__tests__/ventilations-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Transformer le bloc catégorie/unité/activité/montant en répéteur**

Dans `EcritureFormFields` (`ecriture-form.tsx`) : remplacer les champs uniques `montant`/`category_id`/`unite_id`/`activite_id` par un état local `const [vents, setVents] = useState<VentilationDraft[]>([{ amount:'', category_id:null, unite_id:null, activite_id:null }])`. Pour chaque ligne : un `Input` montant + `InlineSelect`/`CategoryPicker` catégorie, `NativeSelect` unité, `NativeSelect` activité. Bouton **« + Ajouter une ventilation »** (`setVents([...vents, {…}])`) et un bouton supprimer par ligne (si `vents.length > 1`). Afficher **« reste à ventiler : {formatAmount(ventilationsRemainderCents(total, vents))} »** ; style d'alerte si ≠ 0. Le montant total = somme des lignes (ou un champ total en lecture seule = Σ). Garder `date_ecriture`, `type`, `description`, `numero_piece`, `mode_paiement_id`, `carte_id`, `justif_attendu`, `notes` inchangés.

> Cas mono-catégorie : une seule ligne pré-affichée → l'UX courante ne change pas visuellement pour l'usage simple.

- [ ] **Step 6: Adapter le payload du wizard**

Dans `nouvelle-ecriture-wizard.tsx`, `handleSubmitToCw` : le `body` envoie `amount_cents` = Σ ventilations et `ventilations: ventilationsToPayload(vents)` au lieu des champs scalaires. Retirer `category_id`/`unite_id`/`activite_id` du body racine. Désactiver le bouton « Faire dans CW » tant que `ventilationsRemainderCents(total, vents) !== 0` ou qu'une ligne est incomplète (catégorie/unité/activité requis pour le push).

> Les boutons « Copier » / « deeplink » (`CwAssistActions`) : dans S0, ils peuvent refléter le total et la 1ʳᵉ ventilation (comportement dégradé acceptable) ou être masqués quand `vents.length > 1`. Choisir « masqués si >1 ventilation » pour ne pas produire un copier-coller trompeur. Documenter par un commentaire.

- [ ] **Step 7: Vérifier manuellement le rendu (dev server)**

Run: `cd web && npx next dev` puis ouvrir `/ecritures/nouveau` connecté trésorier.
Expected: le répéteur s'affiche, « + Ajouter une ventilation » ajoute une ligne, « reste à ventiler » se met à jour, le bouton de validation est bloqué tant que le reste ≠ 0. (Ne PAS pousser à CW ici — c'est Task 8.)

- [ ] **Step 8: Typecheck + lint + commit**

```bash
cd web && npx tsc --noEmit && npx eslint src/components/ecritures/ventilations-form.ts src/components/ecritures/ecriture-form.tsx src/components/ecritures/nouvelle-ecriture-wizard.tsx
git add web/src/components/ecritures/ventilations-form.ts web/src/components/ecritures/__tests__/ventilations-form.test.ts web/src/components/ecritures/ecriture-form.tsx web/src/components/ecritures/nouvelle-ecriture-wizard.tsx
git commit -m "feat(ecritures): UI répéteur de ventilations sur /ecritures/nouveau"
```

---

### Task 8 : Smoke test CW réel (validation end-to-end) — checklist manuelle

**Files:** aucun (validation). Nécessite credentials Comptaweb configurés + session trésorier.

**Interfaces:** Consomme toute la chaîne S0.

- [ ] **Step 1: Créer une écriture à 2 ventilations**

Sur l'app (prod ou local avec creds CW), `/ecritures/nouveau` : dépense **100 €** = **70 € Intendance** + **30 € Petit matériel**, unité/activité mappées CW, mode de paiement mappé. Valider → « Faire dans CW ».

- [ ] **Step 2: Vérifier côté Comptaweb**

Ouvrir la pièce dans Comptaweb : **une seule pièce**, avec **2 lignes de ventilation** (70 Intendance + 30 Petit matériel), total 100 €.

- [ ] **Step 3: Vérifier côté Baloo**

Dans la vue Écritures : **2 lignes groupées** sous un header (total 100 €, « 2 ventilations »), statut `pending_sync`, même `cw_numero_piece`.

- [ ] **Step 4: Lancer une sync et vérifier la réconciliation**

Déclencher `sync_run` (MCP ou UI). Vérifier : les 2 lignes passent en `mirror` (`comptaweb_synced=1`), **sans doublon** et **sans divergent** (point H du spec — `reconcileVentilations` réapparie par montant+catégorie).

- [ ] **Step 5: Nettoyage**

Si l'écriture était jetable, la supprimer dans Comptaweb (action humaine côté CW) ; sinon la conserver comme première vraie écriture multi-ventilation.

---

## Self-Review

**Spec coverage** : A (modèle `ventilation_group_id`)→T1 ; B (payload)→T2 ; C (adapter)→T3 ; D (service)→T4 ; E (route)→T5 ; F (UI wizard)→T7 ; G (affichage)→T6 ; H (sync) + smoke→T8. Hors périmètre (drafts.ts, A/B/#20/C) : non planifié, conforme au spec. ✅

**Placeholders** : aucun « TBD/TODO » ; code concret à chaque step. Les points « adapter le setup du fichier existant » renvoient à un harnais réel présent dans le repo (pattern `depots-update.test.ts`). ✅

**Type consistency** : `EcriturePayload`/`VentilationInput` (T2) réutilisés à l'identique en T3/T4/T5 ; `buildEcritureGroups`/`Group`/`GroupKind` (T6) cohérents ; `ventilationsToPayload`/`ventilationsRemainderCents` (T7) cohérents. ✅
