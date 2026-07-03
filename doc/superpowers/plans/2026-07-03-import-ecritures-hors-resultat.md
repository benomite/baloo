# Import des écritures hors-résultat (transferts inter-structures) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire apparaître dans la liste des écritures **validées** de Baloo les transferts inter-structures (Echelon National) saisis dans Comptaweb mais absents du journal `/recettedepense`, en réutilisant le rapprochement bancaire déjà scrapé — sans draft résiduel, sans polluer le résultat, sans migration.

**Architecture:** Une fonction de service isolée `importHorsResultatTransfers` fait le cœur (dédup par contenu → promotion d'un draft matchant, sinon création d'un mirror), taguée `category_id = 'cat-flux-structures'`. La sync (`runSyncCycle`) l'alimente avec les écritures comptables non rapprochées (`tiers === 'Echelon National'`) déjà renvoyées par `scanDraftsFromComptaweb`. Le `reconcile` du journal exclut les écritures hors-résultat de sa détection « supprimée dans CW ».

**Tech Stack:** TypeScript, Next 16, libsql/Turso, vitest. Tests via `./node_modules/.bin/vitest` depuis `web/`.

## Global Constraints

- Répondre/commenter en français. Commentaires de code en français, style du fichier voisin.
- **JAMAIS de DELETE** de données métier. Ici : uniquement INSERT (création mirror) et UPDATE ciblés (promotion). Pas de suppression.
- **Aucune migration de schéma** : réutiliser `category_id = 'cat-flux-structures'` (catégorie existante, id vérifié en base) comme marqueur hors-résultat.
- Montants en base = centimes, `amount_cents` **absolu** ; le signe vit dans `type` (`'depense'` / `'recette'`).
- Catégorie hors-résultat = `'cat-flux-structures'` ; ensemble d'exclusion = `CATEGORIES_HORS_RESULTAT` (`src/lib/services/overview.ts:23`).
- Tolérance de date pour le match contenu = `DRAFT_DATE_TOLERANCE_DAYS = 3` (jours).
- pnpm cassé → binaires directs : `./node_modules/.bin/vitest`, `./node_modules/.bin/tsc`, `./node_modules/.bin/eslint`.
- Pas de push sans accord explicite (Vercel auto-deploy).

---

### Task 1: Service `importHorsResultatTransfers` (cœur logique isolé)

**Files:**
- Create: `web/src/lib/services/hors-resultat-import.ts`
- Test: `web/src/lib/services/__tests__/hors-resultat-import.test.ts`

**Interfaces:**
- Produces:
  - `interface TransferInput { cwId: number; dateEcriture: string; montantCentimes: number; intitule: string }`
  - `interface ImportTransfersResult { promoted: number; created: number; skipped: number }`
  - `async function importHorsResultatTransfers(db: DbWrapper, ctx: { groupId: string }, transfers: TransferInput[]): Promise<ImportTransfersResult>`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/__tests__/hors-resultat-import.test.ts` :

```ts
// Import des transferts inter-structures (hors résultat) comme lignes validées.
// Promotion d'un draft matchant (adopte le titre CW + cat-flux-structures) ;
// sinon création ; dédup par contenu contre les écritures non-draft.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let idc = 0;
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-NEW-${++idc}`,
  currentTimestamp: () => '2026-07-03T10:00:00Z',
}));

import { importHorsResultatTransfers } from '../hors-resultat-import';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, category_id TEXT, status TEXT,
      comptaweb_synced INTEGER DEFAULT 0, comptaweb_ecriture_id INTEGER,
      justif_attendu INTEGER DEFAULT 1, updated_at TEXT, created_at TEXT
    );
  `);
  return db;
}

const TRANSFER = {
  cwId: 2403659,
  dateEcriture: '2026-06-01',
  montantCentimes: -15900,
  intitule: 'Regroupement de 2 prélèvements nationaux du 01/06/2026 pour la structure',
};

describe('importHorsResultatTransfers', () => {
  beforeEach(() => { idc = 0; });

  it('promeut un draft matchant en ligne validée (titre CW + cat-flux-structures)', async () => {
    const db = await setup();
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status)
       VALUES ('ECR-368', 'g', '2026-06-03', 'PRLV SEPA/SCOUTS ET GUIDES DE F ...', 15900, 'depense', 'draft')`,
    ).run();

    const res = await importHorsResultatTransfers(db, { groupId: 'g' }, [TRANSFER]);

    expect(res).toEqual({ promoted: 1, created: 0, skipped: 0 });
    const e = await db.prepare(
      'SELECT status, description, category_id, comptaweb_ecriture_id, comptaweb_synced FROM ecritures WHERE id = ?',
    ).get('ECR-368');
    expect(e).toMatchObject({
      status: 'mirror',
      description: TRANSFER.intitule,
      category_id: 'cat-flux-structures',
      comptaweb_ecriture_id: 2403659,
      comptaweb_synced: 1,
    });
  });

  it('crée une ligne validée quand aucun draft ne matche', async () => {
    const db = await setup();
    const res = await importHorsResultatTransfers(db, { groupId: 'g' }, [TRANSFER]);
    expect(res).toEqual({ promoted: 0, created: 1, skipped: 0 });
    const e = await db.prepare(
      'SELECT status, type, amount_cents, category_id FROM ecritures WHERE comptaweb_ecriture_id = 2403659',
    ).get();
    expect(e).toMatchObject({ status: 'mirror', type: 'depense', amount_cents: 15900, category_id: 'cat-flux-structures' });
  });

  it('ne ré-importe pas un transfert déjà mirroré (dédup par contenu, pas par id)', async () => {
    const db = await setup();
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, comptaweb_ecriture_id, comptaweb_synced)
       VALUES ('ECR-X', 'g', '2026-06-01', 'déjà là', 15900, 'depense', 'mirror', 999999, 1)`,
    ).run();
    const res = await importHorsResultatTransfers(db, { groupId: 'g' }, [TRANSFER]);
    expect(res).toEqual({ promoted: 0, created: 0, skipped: 1 });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM ecritures').get<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/hors-resultat-import.test.ts`
Expected: FAIL — `Failed to resolve import "../hors-resultat-import"` (module absent).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/lib/services/hors-resultat-import.ts` :

```ts
import type { DbWrapper } from '../db';
import { nextId, currentTimestamp } from '../ids';

// Catégorie « hors résultat » (flux inter-structures) : exclut l'écriture du
// résultat et des budgets (cf. CATEGORIES_HORS_RESULTAT dans overview.ts) tout
// en la gardant dans la trésorerie. Existe en base (comptaweb_id 94).
const CAT_FLUX_STRUCTURES = 'cat-flux-structures';
// Même tolérance que le match contenu du reconcile (drafts.ts / sync-cycle.ts).
const DATE_TOLERANCE_DAYS = 3;

export interface TransferInput {
  cwId: number;
  dateEcriture: string; // ISO YYYY-MM-DD
  montantCentimes: number; // signé (négatif = dépense)
  intitule: string;
}

export interface ImportTransfersResult {
  promoted: number;
  created: number;
  skipped: number;
}

/**
 * Importe les transferts inter-structures (Echelon National) déjà comptabilisés
 * dans Comptaweb mais absents du journal `/recettedepense`, comme lignes
 * VALIDÉES (mirror) dans Baloo. Pour chaque transfert :
 *   1. déjà mirroré (par contenu) → skip (l'id du rapprochement ≠ id du journal,
 *      donc dédup par contenu, jamais par id) ;
 *   2. un seul draft matchant → promotion en ligne validée (adopte le titre CW) ;
 *   3. sinon → création directe d'une ligne validée.
 * Ne supprime jamais rien (règle CLAUDE.md). Marque `cat-flux-structures` →
 * hors résultat + exclusion de la détection « supprimée dans CW » du reconcile.
 */
export async function importHorsResultatTransfers(
  db: DbWrapper,
  { groupId }: { groupId: string },
  transfers: TransferInput[],
): Promise<ImportTransfersResult> {
  let promoted = 0;
  let created = 0;
  let skipped = 0;

  for (const t of transfers) {
    const type = t.montantCentimes < 0 ? 'depense' : 'recette';
    const amountAbs = Math.abs(t.montantCentimes);

    // 1. Déjà mirrorée (par CONTENU : montant + type + date proche).
    const existing = await db
      .prepare(
        `SELECT id FROM ecritures
          WHERE group_id = ? AND status IN ('mirror','pending_sync','pending_cw','divergent')
            AND amount_cents = ? AND type = ?
            AND ABS(julianday(date_ecriture) - julianday(?)) <= ?
          LIMIT 1`,
      )
      .get<{ id: string }>(groupId, amountAbs, type, t.dateEcriture, DATE_TOLERANCE_DAYS);
    if (existing) { skipped++; continue; }

    const now = currentTimestamp();

    // 2. Un SEUL draft matchant → promotion en ligne validée.
    const drafts = await db
      .prepare(
        `SELECT id FROM ecritures
          WHERE group_id = ? AND status = 'draft' AND comptaweb_ecriture_id IS NULL
            AND amount_cents = ? AND type = ?
            AND ABS(julianday(date_ecriture) - julianday(?)) <= ?`,
      )
      .all<{ id: string }>(groupId, amountAbs, type, t.dateEcriture, DATE_TOLERANCE_DAYS);

    if (drafts.length === 1) {
      await db
        .prepare(
          `UPDATE ecritures SET status = 'mirror', comptaweb_synced = 1,
             comptaweb_ecriture_id = ?, description = ?, category_id = ?,
             justif_attendu = 0, updated_at = ?
           WHERE id = ? AND group_id = ?`,
        )
        .run(t.cwId, t.intitule, CAT_FLUX_STRUCTURES, now, drafts[0].id, groupId);
      promoted++;
      continue;
    }

    // 3. Sinon (0 draft, ou ≥2 = ambigu : on ne touche pas les drafts) →
    //    création directe. Garantit qu'au bout du compte la ligne validée existe.
    const id = await nextId('ECR');
    await db
      .prepare(
        `INSERT INTO ecritures
           (id, group_id, date_ecriture, description, amount_cents, type,
            category_id, status, comptaweb_synced, comptaweb_ecriture_id,
            justif_attendu, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'mirror', 1, ?, 0, ?, ?)`,
      )
      .run(id, groupId, t.dateEcriture, t.intitule, amountAbs, type, CAT_FLUX_STRUCTURES, t.cwId, now, now);
    created++;
  }

  return { promoted, created, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/hors-resultat-import.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/hors-resultat-import.ts web/src/lib/services/__tests__/hors-resultat-import.test.ts
git commit -m "feat(sync): service importHorsResultatTransfers (transferts inter-structures en lignes validées)"
```

---

### Task 2: Exposer `ecrituresComptables` depuis `scanDraftsFromComptaweb`

**Files:**
- Modify: `web/src/lib/services/drafts.ts` (interface `ScanDraftsResult` + valeur de retour de `scanDraftsFromComptaweb`)
- Test: `web/src/lib/services/__tests__/drafts-comptables-passthrough.test.ts`

**Interfaces:**
- Consumes: type `EcritureComptableNonRapprochee` (depuis `../comptaweb`).
- Produces: `ScanDraftsResult.ecrituresComptables?: EcritureComptableNonRapprochee[]` (les écritures comptables non rapprochées telles que renvoyées par `listRapprochementBancaire`).

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/__tests__/drafts-comptables-passthrough.test.ts` :

```ts
// scanDraftsFromComptaweb doit exposer les écritures comptables non rapprochées
// (data.ecrituresComptables), pour que la sync importe les transferts hors résultat.
import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

const dataRef: { value: unknown } = { value: { ecrituresBancaires: [], ecrituresComptables: [] } };
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async () => dataRef.value,
  listRapprochementBancaire: vi.fn(),
  createEcriture: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-1`,
  currentTimestamp: () => '2026-07-03T00:00:00Z',
}));

import { scanDraftsFromComptaweb } from '../drafts';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, unite_id TEXT, date_ecriture TEXT,
      description TEXT, amount_cents INTEGER, type TEXT, category_id TEXT, mode_paiement_id TEXT,
      activite_id TEXT, numero_piece TEXT, status TEXT, justif_attendu INTEGER, comptaweb_synced INTEGER,
      ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER,
      carte_id TEXT, libelle_origine TEXT, notes TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
    CREATE TABLE remboursements (id TEXT, ecriture_id TEXT);
    CREATE TABLE modes_paiement (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT, group_id TEXT, code_externe TEXT, statut TEXT);
  `);
  return db;
}

describe('scanDraftsFromComptaweb — expose ecrituresComptables', () => {
  it('renvoie les écritures comptables non rapprochées telles quelles', async () => {
    const db = await setup();
    dataRef.value = {
      ecrituresBancaires: [],
      ecrituresComptables: [{
        id: 2403659, dateEcriture: '2026-06-01', type: 'Dépense', intitule: 'Regroupement...',
        devise: 'EUR', montantCentimes: -15900, numeroPiece: '', modeTransaction: 'Virement', tiers: 'Echelon National',
      }],
    };
    const res = await scanDraftsFromComptaweb({ groupId: 'g' }, db);
    expect(res.ecrituresComptables).toHaveLength(1);
    expect(res.ecrituresComptables?.[0].id).toBe(2403659);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/drafts-comptables-passthrough.test.ts`
Expected: FAIL — `res.ecrituresComptables` est `undefined` (`expected undefined to have length 1`).

- [ ] **Step 3: Write minimal implementation**

Dans `web/src/lib/services/drafts.ts` :

3a. Ajouter le type à l'import depuis `../comptaweb` (bloc `import type { ... } from '../comptaweb';`) :

```ts
import type {
  EcritureBancaireNonRapprochee,
  EcritureComptableNonRapprochee,
  SousLigneDsp2,
  CreateEcritureInput,
} from '../comptaweb';
```

3b. Dans `interface ScanDraftsResult`, ajouter le champ (avant `erreur?`) :

```ts
  // Écritures comptables non rapprochées de CW (dont les transferts hors
  // résultat), transmises telles quelles pour l'import de la sync.
  ecrituresComptables?: EcritureComptableNonRapprochee[];
```

3c. Dans `scanDraftsFromComptaweb`, remplacer le `return` de succès :

```ts
    return { crees, existants, supprimes, doublons, corriges, ecrituresComptables: data.ecrituresComptables };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/drafts-comptables-passthrough.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/drafts.ts web/src/lib/services/__tests__/drafts-comptables-passthrough.test.ts
git commit -m "feat(sync): scanDraftsFromComptaweb expose ecrituresComptables (source des transferts hors résultat)"
```

---

### Task 3: Exclure les écritures hors-résultat de la détection `supprimee_cw`

**Files:**
- Modify: `web/src/lib/services/ecritures-sync-reconcile.ts` (interface `BalooRow` + branche `deletions` de `reconcile`)
- Modify: `web/src/lib/services/sync-cycle.ts` (`loadBalooRows` renseigne `horsResultat`)
- Test: `web/src/lib/services/__tests__/ecritures-sync-reconcile-hors-resultat.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES_HORS_RESULTAT` (depuis `./overview`).
- Produces: `BalooRow.horsResultat?: boolean` (vrai = écriture hors résultat, jamais présente dans `/recettedepense`, donc jamais « supprimée » via le journal).

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/services/__tests__/ecritures-sync-reconcile-hors-resultat.test.ts` :

```ts
// Une écriture hors-résultat (cat-flux-structures) n'est jamais dans le journal
// /recettedepense : le reconcile ne doit PAS la marquer supprimee_cw même si son
// comptaweb_ecriture_id tombe dans la plage couverte du snapshot.
import { describe, it, expect } from 'vitest';
import { reconcile, type CwSnapshotRow, type BalooRow } from '../ecritures-sync-reconcile';

function snap(cwId: number): CwSnapshotRow {
  return {
    cwId, numeroPiece: '', date: '2026-06-10', type: 'depense', montantCents: -1000,
    intitule: 'x', modeTransaction: '', categorieTiers: '', signature: 's',
  };
}
function baloo(id: string, cwId: number, horsResultat: boolean): BalooRow {
  return {
    id, status: 'mirror', comptawebEcritureId: cwId, amountCents: -1000, type: 'depense',
    dateEcriture: '2026-06-10', cwSignature: 's', hasImputation: true, horsResultat,
  };
}

describe('reconcile — exclusion hors-résultat de supprimee_cw', () => {
  it('ne marque PAS supprimée une écriture hors-résultat absente du journal', () => {
    // Plage couverte [1000, 2000] ; l'écriture 1500 est absente du snapshot.
    const plan = reconcile([snap(1000), snap(2000)], [baloo('ECR-HR', 1500, true)], { dateToleranceDays: 3 });
    expect(plan.deletions).not.toContain('ECR-HR');
  });

  it('marque bien supprimée une écriture ordinaire absente (plage couverte)', () => {
    const plan = reconcile([snap(1000), snap(2000)], [baloo('ECR-OK', 1500, false)], { dateToleranceDays: 3 });
    expect(plan.deletions).toContain('ECR-OK');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/ecritures-sync-reconcile-hors-resultat.test.ts`
Expected: FAIL — soit erreur TS (`horsResultat` inconnu de `BalooRow`), soit le 1er test échoue (`ECR-HR` présent dans `deletions`).

- [ ] **Step 3: Write minimal implementation**

3a. Dans `web/src/lib/services/ecritures-sync-reconcile.ts`, ajouter le champ à `interface BalooRow` (après `hasImputation`) :

```ts
  /**
   * Vrai si l'écriture est hors résultat (cat-flux-structures) : elle n'est
   * jamais dans le journal /recettedepense, donc jamais « disparue du journal ».
   * Exclue de la détection supprimee_cw.
   */
  horsResultat?: boolean;
```

3b. Dans la fonction `reconcile`, branche « suppression » (le `else if` qui pousse dans `plan.deletions`), ajouter la garde `!row.horsResultat` :

```ts
    } else if (hasRange && !row.horsResultat && row.comptawebEcritureId >= minId && row.comptawebEcritureId <= maxId) {
      // Reliée, dans la plage couverte, absente, ET pas hors-résultat → vraie suppression.
      plan.deletions.push(row.id);
    }
```

3c. Dans `web/src/lib/services/sync-cycle.ts`, importer la constante (à côté des autres imports de `./overview` si présent, sinon nouvel import) :

```ts
import { CATEGORIES_HORS_RESULTAT } from './overview';
```

3d. Dans `loadBalooRows` (`sync-cycle.ts`), renseigner `horsResultat` dans le `.map(...)` (le SELECT lit déjà `category_id`) :

```ts
        hasImputation: r.activite_id != null || r.unite_id != null || r.category_id != null,
        horsResultat: r.category_id != null && (CATEGORIES_HORS_RESULTAT as readonly string[]).includes(r.category_id),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/ecritures-sync-reconcile-hors-resultat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/ecritures-sync-reconcile.ts web/src/lib/services/sync-cycle.ts web/src/lib/services/__tests__/ecritures-sync-reconcile-hors-resultat.test.ts
git commit -m "fix(sync): exclure les écritures hors-résultat de la détection supprimee_cw"
```

---

### Task 4: Brancher l'import des transferts dans `runSyncCycle`

**Files:**
- Modify: `web/src/lib/services/sync-cycle.ts` (import du service + nouvelle passe 7f)
- Test: `web/src/lib/services/__tests__/sync-cycle.test.ts` (ajout d'un `describe`)

**Interfaces:**
- Consumes: `importHorsResultatTransfers` (Task 1), `ScanDraftsResult.ecrituresComptables` (Task 2). Les compteurs de transferts sont repliés dans les compteurs existants : `promoted` (promotions) → `promoted_to_mirror`, `created` (créations) → `imported_from_cw`. Pas de nouvelle colonne `sync_runs`.

- [ ] **Step 1: Write the failing test**

Ajouter à la fin de `web/src/lib/services/__tests__/sync-cycle.test.ts` (le fichier importe déjà `runSyncCycle`, `setupDb`, `mockOpts`, `DbWrapper`) :

```ts
describe('runSyncCycle — import des transferts hors résultat (Echelon National)', () => {
  it('promeut le draft bancaire matchant en ligne validée cat-flux-structures', async () => {
    const { db } = await setupDb();
    // Draft bancaire local -159 € (03/06), en attente.
    await db.prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, comptaweb_synced)
       VALUES ('ECR-368', 'g1', '2026-06-03', 'PRLV SEPA/SCOUTS ET GUIDES DE F ...', 15900, 'depense', 'draft', 0)`,
    ).run();

    const opts = mockOpts({
      ecritures: [], // journal /recettedepense vide
      scanDrafts: async () => ({
        crees: 0,
        existants: 0,
        ecrituresComptables: [{
          id: 2403659, dateEcriture: '2026-06-01', type: 'Dépense',
          intitule: 'Regroupement de 2 prélèvements nationaux du 01/06/2026 pour la structure',
          devise: 'EUR', montantCentimes: -15900, numeroPiece: '', modeTransaction: 'Virement', tiers: 'Echelon National',
        }],
      }),
      force: true,
    });

    const res = await runSyncCycle(db, 'g1', opts);

    expect(res.status).toBe('ok');
    expect(res.promoted_to_mirror).toBe(1);
    const e = await db.prepare(
      'SELECT status, description, category_id, comptaweb_ecriture_id FROM ecritures WHERE id = ?',
    ).get<{ status: string; description: string; category_id: string; comptaweb_ecriture_id: number }>('ECR-368');
    expect(e?.status).toBe('mirror');
    expect(e?.category_id).toBe('cat-flux-structures');
    expect(e?.comptaweb_ecriture_id).toBe(2403659);
    expect(e?.description).toContain('Regroupement');
  });

  it('ignore une écriture comptable ordinaire (tiers ≠ Echelon National)', async () => {
    const { db } = await setupDb();
    const opts = mockOpts({
      ecritures: [],
      scanDrafts: async () => ({
        crees: 0,
        existants: 0,
        ecrituresComptables: [{
          id: 2303515, dateEcriture: '2025-09-20', type: 'Dépense', intitule: 'hébergement weekend SCC',
          devise: 'EUR', montantCentimes: -16250, numeroPiece: 'SA25-13', modeTransaction: 'Chèque', tiers: 'Autre : pas structure SGDF',
        }],
      }),
      force: true,
    });

    const res = await runSyncCycle(db, 'g1', opts);
    expect(res.status).toBe('ok');
    const n = await db.prepare("SELECT COUNT(*) AS n FROM ecritures WHERE comptaweb_ecriture_id = 2303515").get<{ n: number }>();
    expect(n?.n).toBe(0); // pas importée par cette passe
  });
});
```

Note : si `SyncCycleOptions['scanDrafts']` refuse `ecrituresComptables` au typecheck, c'est que Task 2 n'a pas été faite — Task 2 est prérequise.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/sync-cycle.test.ts -t "transferts hors résultat"`
Expected: FAIL — `promoted_to_mirror` vaut 0 et `ECR-368` reste `status='draft'` (la passe n'existe pas encore).

- [ ] **Step 3: Write minimal implementation**

3a. Dans `web/src/lib/services/sync-cycle.ts`, ajouter l'import (près des autres imports de services) :

```ts
import { importHorsResultatTransfers } from './hors-resultat-import';
```

3b. Insérer la nouvelle passe **après** la boucle des suggestions (« 7e. Suggestions de lien ») et **avant** « 8. Détection stale ». `draftsResult` (résultat de `scanDrafts(groupId)`) et les variables `promoted` / `imported` sont déjà en portée :

```ts
    // 7f. Transferts inter-structures (hors résultat) : ces écritures CW sont
    //     dans le rapprochement bancaire mais PAS dans /recettedepense. On les
    //     importe comme lignes validées (mirror), en promouvant le draft
    //     bancaire matchant s'il existe. Filtre sur tiers 'Echelon National'.
    const comptables = draftsResult.ecrituresComptables ?? [];
    const transfers = comptables
      .filter((c) => c.tiers.trim() === 'Echelon National')
      .map((c) => ({
        cwId: c.id,
        dateEcriture: c.dateEcriture,
        montantCentimes: c.montantCentimes,
        intitule: c.intitule,
      }));
    if (transfers.length > 0) {
      const transferRes = await importHorsResultatTransfers(db, { groupId }, transfers);
      promoted += transferRes.promoted;
      imported += transferRes.created;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && ./node_modules/.bin/vitest run src/lib/services/__tests__/sync-cycle.test.ts`
Expected: PASS (tous les tests du fichier, dont les 2 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/sync-cycle.ts web/src/lib/services/__tests__/sync-cycle.test.ts
git commit -m "feat(sync): importer les transferts inter-structures (Echelon National) comme lignes validées"
```

---

### Task 5: Vérification finale (typecheck, lint, suite complète)

**Files:** aucun (garde-fou global).

- [ ] **Step 1: Typecheck**

Run: `cd web && ./node_modules/.bin/tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 2: Lint des fichiers touchés**

Run: `cd web && ./node_modules/.bin/eslint src/lib/services/hors-resultat-import.ts src/lib/services/drafts.ts src/lib/services/ecritures-sync-reconcile.ts src/lib/services/sync-cycle.ts`
Expected: aucune erreur.

- [ ] **Step 3: Suite complète**

Run: `cd web && ./node_modules/.bin/vitest run`
Expected: tous les tests verts (baseline 641 + nouveaux).

- [ ] **Step 4: Commit éventuel**

Si l'un des trois a nécessité un ajustement, committer :

```bash
git add -A
git commit -m "chore(sync): typecheck + lint + suite verte pour l'import hors-résultat"
```

---

## Self-Review

- **Couverture spec** : source d'import (Task 2 + 4 filtre Echelon National) ✅ ; promotion draft adopte titre CW (Task 1 + test) ✅ ; création si pas de draft (Task 1) ✅ ; dédup par contenu (Task 1) ✅ ; `cat-flux-structures` → hors résultat + exclusion suppression (Task 1 pose la catégorie, Task 3 exclut) ✅ ; pas de scrape détail pour ces écritures (Task 1 construit depuis la ligne) ✅ ; aucune migration (réutilise catégorie + compteurs existants) ✅. Hors V1 (rapprochement CW manuel, transferts déjà rapprochés) : non implémenté, conforme à la spec.
- **Placeholders** : aucun — tout le code est fourni.
- **Cohérence des types** : `TransferInput`/`ImportTransfersResult`/`importHorsResultatTransfers` (Task 1) réutilisés à l'identique en Task 4 ; `ecrituresComptables` (Task 2) consommé en Task 4 ; `BalooRow.horsResultat` (Task 3) produit par `loadBalooRows` et lu par `reconcile`.
- **Point de vigilance perf** : pas de scrape supplémentaire (les comptables viennent de `scanDrafts`). Pas d'impact sur la durée de sync.
```
