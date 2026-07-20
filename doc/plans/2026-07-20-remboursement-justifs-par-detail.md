# Remboursements — tri des détails par date + justifs rattachés aux détails — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Côté trésorier, permettre de trier les détails d'une demande de remboursement par date (formulaire + affichage) et de rattacher chaque justificatif existant à une ou plusieurs lignes de détail, avec un suivi visuel « X/Y détails justifiés ».

**Architecture :** Nouvelle table de liaison plusieurs-à-plusieurs `remboursement_ligne_justificatifs`. Prérequis : l'édition d'une demande passe d'un `DELETE`-tout-puis-réinsère à une **réconciliation** qui préserve les `id` de lignes (sinon les rattachements seraient orphelinés à chaque édition). L'affectation est de la donnée pure (aucun upload) : le trésorier coche les lignes couvertes par un justif déjà déposé. Le tableau de détail devient un composant client pour le tri interactif et l'affichage des pastilles.

**Tech Stack :** Next 16 (App Router, server components + server actions), TypeScript, libsql/Turso, vitest, Tailwind (design system maison), lucide-react.

## Global Constraints

- **Jamais de `DELETE` en masse sur des données métier** — toujours réconcilier (UPSERT + delete ciblé des seules lignes retirées par l'utilisateur). Règle CLAUDE.md.
- **Montants en centimes** partout en BDD.
- **Pas de CHECK SQL** sur les nouvelles tables (validation côté code).
- **Nouvelle table + index dans `web/src/lib/auth/schema.ts`** (pas `business-schema.ts`), car `CREATE TABLE IF NOT EXISTS` de `business-schema.ts` est un no-op sur BDD existante. L'`ALTER`/`CREATE INDEX` sur colonnes récentes vit dans `auth/schema.ts` qui tourne après (cf. `web/AGENTS.md`).
- **Fichiers `'use server'`** : n'exportent QUE des server actions serializables. Les helpers de lecture vivent dans des fichiers sans `'use server'`.
- **Commande de test** : `pnpm test <path>` (= `vitest run <path>`), à lancer depuis `web/`.
- **Isolation multi-tenant** : toute requête filtre sur `group_id`.
- **Pas de `git push`** — commits locaux uniquement.

---

### Task 1: Table de liaison `remboursement_ligne_justificatifs`

**Files:**
- Modify: `web/src/lib/auth/schema.ts:412` (juste après le bloc `CREATE TABLE remboursement_lignes`)

**Interfaces:**
- Produces: table SQL `remboursement_ligne_justificatifs(ligne_id, justificatif_id, created_at)` avec PK composite et deux index. Consommée par les tasks 2, 6, 7.

Cette task est une migration de schéma pure ; elle n'a pas de test unitaire dédié (les services des tasks 2 et 4 recréent la table dans leur propre `SETUP` in-memory). Vérification = typecheck + build.

- [ ] **Step 1: Ajouter la table après le bloc `remboursement_lignes`**

Dans `web/src/lib/auth/schema.ts`, juste après le `await db.exec(\`... CREATE INDEX ... idx_rbt_ligne_rbt ...\`);` (ligne ~412), insérer :

```ts
  // Rattachement justif ↔ ligne de détail (spec 2026-07-20). Un justif
  // (déposé sur la demande, entity_type='remboursement') peut couvrir
  // plusieurs lignes ; une ligne peut avoir plusieurs justifs. Liaison
  // plusieurs-à-plusieurs, sans CHECK. Les paires sont supprimées quand
  // la ligne est retirée (réconciliation) ou réaffectées par le trésorier.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS remboursement_ligne_justificatifs (
      ligne_id        TEXT NOT NULL REFERENCES remboursement_lignes(id),
      justificatif_id TEXT NOT NULL REFERENCES justificatifs(id),
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      PRIMARY KEY (ligne_id, justificatif_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rlj_ligne ON remboursement_ligne_justificatifs(ligne_id);
    CREATE INDEX IF NOT EXISTS idx_rlj_justif ON remboursement_ligne_justificatifs(justificatif_id);
  `);
```

- [ ] **Step 2: Vérifier le typecheck / build**

Run: `cd web && pnpm build`
Expected: build OK (pas d'erreur TS ni de SQL).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/auth/schema.ts
git commit -m "feat(rembs): table de liaison justif↔ligne de détail"
```

---

### Task 2: Service d'affectation justif↔ligne (`remboursement-justifs.ts`)

**Files:**
- Create: `web/src/lib/services/remboursement-justifs.ts`
- Test: `web/src/lib/services/__tests__/remboursement-justifs.test.ts`

**Interfaces:**
- Consumes: `getDb()` de `../../db`.
- Produces:
  - `interface LigneJustifAssignation { ligne_id: string; justificatif_id: string }`
  - `listAssignationsLignes(remboursementId: string): Promise<LigneJustifAssignation[]>`
  - `setJustificatifLignes(ctx: { groupId: string }, remboursementId: string, justificatifId: string, ligneIds: string[]): Promise<void>` — remplace l'ensemble des lignes affectées à CE justif. Throw si le justif n'appartient pas à la demande (`entity_type='remboursement'`, `entity_id=remboursementId`, `group_id`) ou si une `ligneId` n'appartient pas à la demande.
  - `computeCouverture(lignes: { id: string }[], assignations: { ligne_id: string }[]): { justifiees: number; total: number }` — helper pur.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/src/lib/services/__tests__/remboursement-justifs.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import {
  listAssignationsLignes,
  setJustificatifLignes,
  computeCouverture,
} from '../remboursement-justifs';

const SETUP = `
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT);
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY, remboursement_id TEXT NOT NULL, date_depense TEXT,
    amount_cents INTEGER, nature TEXT, notes TEXT, type TEXT, created_at TEXT
  );
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, uploaded_at TEXT
  );
  CREATE TABLE remboursement_ligne_justificatifs (
    ligne_id TEXT NOT NULL, justificatif_id TEXT NOT NULL, created_at TEXT,
    PRIMARY KEY (ligne_id, justificatif_id)
  );
`;

async function setup(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  await db.prepare("INSERT INTO remboursements (id, group_id) VALUES ('RBT-1','g')").run();
  await db.prepare("INSERT INTO remboursements (id, group_id) VALUES ('RBT-2','g')").run();
  for (const l of ['L1', 'L2', 'L3']) {
    await db.prepare(
      "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature) VALUES (?, 'RBT-1', '2026-06-01', 1000, 'x')",
    ).run(l);
  }
  // Ligne d'une AUTRE demande.
  await db.prepare(
    "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature) VALUES ('LX','RBT-2','2026-06-01',1000,'x')",
  ).run();
  // Justif de RBT-1 + justif d'une autre demande.
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J1','g','p/j1','j1.pdf','remboursement','RBT-1')",
  ).run();
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J2','g','p/j2','j2.pdf','remboursement','RBT-2')",
  ).run();
  return db;
}

describe('remboursement-justifs', () => {
  beforeEach(async () => {
    testDb = await setup();
  });

  it('setJustificatifLignes affecte un justif à plusieurs lignes', async () => {
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L1', 'L2']);
    const a = await listAssignationsLignes('RBT-1');
    expect(a.map((x) => x.ligne_id).sort()).toEqual(['L1', 'L2']);
    expect(a.every((x) => x.justificatif_id === 'J1')).toBe(true);
  });

  it('setJustificatifLignes remplace l\'ensemble (retire les décochées)', async () => {
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L1', 'L2']);
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L3']);
    const a = await listAssignationsLignes('RBT-1');
    expect(a.map((x) => x.ligne_id)).toEqual(['L3']);
  });

  it('setJustificatifLignes([]) retire toutes les affectations du justif', async () => {
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L1']);
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', []);
    expect(await listAssignationsLignes('RBT-1')).toHaveLength(0);
  });

  it('refuse un justif d\'une autre demande', async () => {
    await expect(
      setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J2', ['L1']),
    ).rejects.toThrow();
  });

  it('refuse une ligne d\'une autre demande', async () => {
    await expect(
      setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['LX']),
    ).rejects.toThrow();
  });

  it('computeCouverture compte les lignes ayant ≥1 justif', () => {
    const lignes = [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }];
    const assignations = [
      { ligne_id: 'L1' },
      { ligne_id: 'L1' },
      { ligne_id: 'L3' },
    ];
    expect(computeCouverture(lignes, assignations)).toEqual({ justifiees: 2, total: 3 });
  });

  it('computeCouverture sur 0 ligne', () => {
    expect(computeCouverture([], [])).toEqual({ justifiees: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd web && pnpm test src/lib/services/__tests__/remboursement-justifs.test.ts`
Expected: FAIL — `Cannot find module '../remboursement-justifs'` (le service n'existe pas encore).

- [ ] **Step 3: Écrire le service**

Créer `web/src/lib/services/remboursement-justifs.ts` :

```ts
import { getDb } from '../db';
import { currentTimestamp } from '../ids';

// Rattachement justif ↔ ligne de détail d'un remboursement (spec
// 2026-07-20). Liaison plusieurs-à-plusieurs, affectation côté trésorier.
// Aucun upload : on ne fait que relier des justifs DÉJÀ déposés sur la
// demande (entity_type='remboursement') à ses lignes de détail.

export interface LigneJustifAssignation {
  ligne_id: string;
  justificatif_id: string;
}

export async function listAssignationsLignes(
  remboursementId: string,
): Promise<LigneJustifAssignation[]> {
  return await getDb()
    .prepare(
      `SELECT rlj.ligne_id, rlj.justificatif_id
       FROM remboursement_ligne_justificatifs rlj
       JOIN remboursement_lignes l ON l.id = rlj.ligne_id
       WHERE l.remboursement_id = ?
       ORDER BY rlj.ligne_id, rlj.justificatif_id`,
    )
    .all<LigneJustifAssignation>(remboursementId);
}

// Remplace l'ensemble des lignes couvertes par CE justif. `ligneIds` vide
// = on retire toutes ses affectations. Garde-fous : le justif et chaque
// ligne doivent appartenir à la même demande / au même groupe.
export async function setJustificatifLignes(
  { groupId }: { groupId: string },
  remboursementId: string,
  justificatifId: string,
  ligneIds: string[],
): Promise<void> {
  const db = getDb();

  const justif = await db
    .prepare(
      `SELECT id FROM justificatifs
       WHERE id = ? AND group_id = ? AND entity_type = 'remboursement' AND entity_id = ?`,
    )
    .get<{ id: string }>(justificatifId, groupId, remboursementId);
  if (!justif) {
    throw new Error(`Justificatif ${justificatifId} introuvable sur la demande ${remboursementId}.`);
  }

  const wanted = [...new Set(ligneIds)];
  for (const ligneId of wanted) {
    const ligne = await db
      .prepare('SELECT id FROM remboursement_lignes WHERE id = ? AND remboursement_id = ?')
      .get<{ id: string }>(ligneId, remboursementId);
    if (!ligne) {
      throw new Error(`Ligne ${ligneId} n'appartient pas à la demande ${remboursementId}.`);
    }
  }

  // Réaffectation : on efface les paires de CE justif (table de liaison
  // pure, aucune donnée métier attachée) puis on ré-insère la sélection.
  await db
    .prepare('DELETE FROM remboursement_ligne_justificatifs WHERE justificatif_id = ?')
    .run(justificatifId);
  const now = currentTimestamp();
  for (const ligneId of wanted) {
    await db
      .prepare(
        'INSERT INTO remboursement_ligne_justificatifs (ligne_id, justificatif_id, created_at) VALUES (?, ?, ?)',
      )
      .run(ligneId, justificatifId, now);
  }
}

// Helper pur : combien de lignes ont au moins un justif rattaché.
export function computeCouverture(
  lignes: { id: string }[],
  assignations: { ligne_id: string }[],
): { justifiees: number; total: number } {
  const couvertes = new Set(assignations.map((a) => a.ligne_id));
  const justifiees = lignes.filter((l) => couvertes.has(l.id)).length;
  return { justifiees, total: lignes.length };
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd web && pnpm test src/lib/services/__tests__/remboursement-justifs.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/remboursement-justifs.ts web/src/lib/services/__tests__/remboursement-justifs.test.ts
git commit -m "feat(rembs): service d'affectation justif↔ligne + couverture"
```

---

### Task 3: `reconcileLignes` — édition des lignes en préservant les `id`

**Files:**
- Modify: `web/src/lib/services/remboursements.ts` (ajout de `reconcileLignes` + interface, après `deleteLigne` ~ligne 220)
- Test: `web/src/lib/services/__tests__/remboursement-reconcile-lignes.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `recalcTotal` (déjà dans le même fichier), `randomUUID` (déjà importé), `nullIfEmpty` (déjà importé), `currentTimestamp` (déjà importé).
- Produces:
  - `interface ReconcileLigneInput { id: string | null; date_depense: string; amount_cents: number; nature: string; notes?: string | null; type?: 'depense' | 'km'; distance_km_dixiemes?: number | null; taux_km_millicents?: number | null }`
  - `reconcileLignes(remboursementId: string, lignes: ReconcileLigneInput[]): Promise<void>` — UPDATE les lignes dont l'`id` existe, INSERT celles sans `id` (ou `id` inconnu), DELETE (avec leurs paires justif) les lignes existantes absentes de `lignes`, puis `recalcTotal`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/src/lib/services/__tests__/remboursement-reconcile-lignes.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let uuidSeq = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => `NEW-${++uuidSeq}` };
});

import { reconcileLignes, listLignes } from '../remboursements';

const SETUP = `
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, total_cents INTEGER, amount_cents INTEGER, updated_at TEXT);
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY, remboursement_id TEXT NOT NULL, date_depense TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, nature TEXT NOT NULL, notes TEXT,
    type TEXT DEFAULT 'depense', distance_km_dixiemes INTEGER, taux_km_millicents INTEGER,
    created_at TEXT
  );
  CREATE TABLE remboursement_ligne_justificatifs (
    ligne_id TEXT NOT NULL, justificatif_id TEXT NOT NULL, created_at TEXT,
    PRIMARY KEY (ligne_id, justificatif_id)
  );
`;

async function setup(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  await db.prepare("INSERT INTO remboursements (id, group_id, total_cents, amount_cents) VALUES ('RBT-1','g',0,0)").run();
  await db.prepare(
    "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, type, created_at) VALUES ('L1','RBT-1','2026-06-01',1000,'A','depense','t1')",
  ).run();
  await db.prepare(
    "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, type, created_at) VALUES ('L2','RBT-1','2026-06-02',2000,'B','depense','t2')",
  ).run();
  return db;
}

async function assignations(db: DbWrapper): Promise<string[]> {
  const rows = await db.prepare('SELECT ligne_id FROM remboursement_ligne_justificatifs ORDER BY ligne_id').all<{ ligne_id: string }>();
  return rows.map((r) => r.ligne_id);
}

describe('reconcileLignes', () => {
  beforeEach(async () => {
    uuidSeq = 0;
    testDb = await setup();
    // Rattachement justif sur L1.
    await testDb.prepare("INSERT INTO remboursement_ligne_justificatifs (ligne_id, justificatif_id, created_at) VALUES ('L1','J1','t')").run();
  });

  it('préserve l\'id + le rattachement d\'une ligne inchangée, UPDATE en place', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'L1', date_depense: '2026-06-01', amount_cents: 1500, nature: 'A modifié' },
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['L1', 'L2']);
    const l1 = lignes.find((l) => l.id === 'L1')!;
    expect(l1.amount_cents).toBe(1500);
    expect(l1.nature).toBe('A modifié');
    // Le rattachement justif de L1 survit (id préservé).
    expect(await assignations(testDb)).toEqual(['L1']);
  });

  it('INSERT une nouvelle ligne (id null) avec un nouvel id', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'L1', date_depense: '2026-06-01', amount_cents: 1000, nature: 'A' },
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
      { id: null, date_depense: '2026-06-03', amount_cents: 500, nature: 'C' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['L1', 'L2', 'NEW-1']);
  });

  it('DELETE une ligne retirée + ses paires justif ; recalcTotal', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['L2']);
    // Le rattachement de L1 (supprimée) est parti.
    expect(await assignations(testDb)).toEqual([]);
    const r = await testDb.prepare('SELECT total_cents FROM remboursements WHERE id=?').get<{ total_cents: number }>('RBT-1');
    expect(r?.total_cents).toBe(2000);
  });

  it('un id inconnu est traité comme une nouvelle ligne', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'INEXISTANT', date_depense: '2026-06-05', amount_cents: 300, nature: 'Z' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['NEW-1']);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd web && pnpm test src/lib/services/__tests__/remboursement-reconcile-lignes.test.ts`
Expected: FAIL — `reconcileLignes is not a function` / export absent.

- [ ] **Step 3: Écrire `reconcileLignes` dans `remboursements.ts`**

Dans `web/src/lib/services/remboursements.ts`, après la fonction `deleteLigne` (ligne ~220), ajouter :

```ts
export interface ReconcileLigneInput {
  // id d'une ligne existante à conserver/mettre à jour, ou null pour une
  // nouvelle ligne.
  id: string | null;
  date_depense: string;
  amount_cents: number;
  nature: string;
  notes?: string | null;
  type?: 'depense' | 'km';
  distance_km_dixiemes?: number | null;
  taux_km_millicents?: number | null;
}

// Réconcilie les lignes d'une demande SANS DELETE en masse : les lignes
// dont l'id est conservé sont mises à jour en place (leurs rattachements
// justif survivent), les nouvelles sont insérées, et seules les lignes
// retirées par l'utilisateur sont supprimées (avec leurs paires de
// liaison justif). Remplace l'ancien DELETE-tout-puis-réinsère qui
// régénérait les id à chaque édition et cassait les rattachements.
export async function reconcileLignes(
  remboursementId: string,
  lignes: ReconcileLigneInput[],
): Promise<void> {
  const db = getDb();

  const existing = await db
    .prepare('SELECT id FROM remboursement_lignes WHERE remboursement_id = ?')
    .all<{ id: string }>(remboursementId);
  const existingIds = new Set(existing.map((r) => r.id));

  const keptIds = new Set(
    lignes.map((l) => l.id).filter((id): id is string => !!id && existingIds.has(id)),
  );

  // 1. Supprimer les lignes retirées + leurs paires justif.
  for (const { id } of existing) {
    if (keptIds.has(id)) continue;
    await db.prepare('DELETE FROM remboursement_ligne_justificatifs WHERE ligne_id = ?').run(id);
    await db.prepare('DELETE FROM remboursement_lignes WHERE id = ?').run(id);
  }

  // 2. UPDATE les conservées, INSERT les nouvelles.
  const now = currentTimestamp();
  for (const l of lignes) {
    if (l.id && existingIds.has(l.id)) {
      await db.prepare(
        `UPDATE remboursement_lignes
         SET date_depense = ?, amount_cents = ?, nature = ?, notes = ?,
             type = ?, distance_km_dixiemes = ?, taux_km_millicents = ?
         WHERE id = ?`,
      ).run(
        l.date_depense,
        l.amount_cents,
        l.nature,
        nullIfEmpty(l.notes),
        l.type ?? 'depense',
        l.distance_km_dixiemes ?? null,
        l.taux_km_millicents ?? null,
        l.id,
      );
    } else {
      await db.prepare(
        `INSERT INTO remboursement_lignes
           (id, remboursement_id, date_depense, amount_cents, nature, notes, type, distance_km_dixiemes, taux_km_millicents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        remboursementId,
        l.date_depense,
        l.amount_cents,
        l.nature,
        nullIfEmpty(l.notes),
        l.type ?? 'depense',
        l.distance_km_dixiemes ?? null,
        l.taux_km_millicents ?? null,
        now,
      );
    }
  }

  await recalcTotal(remboursementId);
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd web && pnpm test src/lib/services/__tests__/remboursement-reconcile-lignes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/remboursements.ts web/src/lib/services/__tests__/remboursement-reconcile-lignes.test.ts
git commit -m "feat(rembs): reconcileLignes — édition sans DELETE en masse, id stables"
```

---

### Task 4: Brancher l'édition sur `reconcileLignes` (transmission des `id`)

**Files:**
- Modify: `web/src/lib/actions/remboursements/_helpers.ts` (interfaces `LigneInput` + `ResolvedLigne`, `parseLignesFromForm`, `resolveLignesWithRate`)
- Modify: `web/src/lib/actions/remboursements/update.ts:102-112` (remplacer DELETE+addLigne par `reconcileLignes`)

**Interfaces:**
- Consumes: `reconcileLignes` + `ReconcileLigneInput` de `../../services/remboursements` (Task 3).
- Produces : `LigneInput` et `ResolvedLigne` gagnent un champ `id: string | null` ; le formulaire (Task 5) transmet `ligne_{i}_id`.

Note : ces fichiers de la couche action sont testés via les tests services (Tasks 2-3). La vérification de cette task = typecheck/build + le smoke manuel de la Task 7.

- [ ] **Step 1: Ajouter `id` à `LigneInput` et le lire dans `parseLignesFromForm`**

Dans `web/src/lib/actions/remboursements/_helpers.ts`, interface `LigneInput` (ligne ~105), ajouter le champ :

```ts
export interface LigneInput {
  id: string | null;               // id d'une ligne existante (édition) ou null
  type: 'depense' | 'km';
  date: string;
  nature: string;
  amount_cents: number;            // dépense : saisi ; km : 0 jusqu'à résolution
  distance_km_dixiemes: number | null;
}
```

Dans `parseLignesFromForm`, lire l'id caché en tête de boucle et le propager aux deux `push` :

```ts
  for (let i = 0; i < ligneCount; i++) {
    const idRaw = ((formData.get(`ligne_${i}_id`) as string | null) ?? '').trim();
    const id = idRaw || null;
    const type = ((formData.get(`ligne_${i}_type`) as string | null) ?? 'depense') === 'km' ? 'km' : 'depense';
    const date = (formData.get(`ligne_${i}_date`) as string | null) ?? '';
    const nature = ((formData.get(`ligne_${i}_nature`) as string | null) ?? '').trim();
    if (!date || !nature) fail(`Ligne ${i + 1} incomplète.`);

    if (type === 'km') {
      const kmRaw = ((formData.get(`ligne_${i}_km`) as string | null) ?? '').trim();
      if (!kmRaw) fail(`Ligne ${i + 1} : nombre de km requis.`);
      let distance_km_dixiemes: number;
      try {
        distance_km_dixiemes = parseDistanceToDixiemes(kmRaw);
      } catch {
        fail(`Ligne ${i + 1} : distance invalide « ${kmRaw} ».`);
        return null as never;
      }
      lignes.push({ id, type: 'km', date, nature, amount_cents: 0, distance_km_dixiemes });
    } else {
      const montantRaw = ((formData.get(`ligne_${i}_montant`) as string | null) ?? '').trim();
      if (!montantRaw) fail(`Ligne ${i + 1} incomplète.`);
      let amount_cents: number;
      try {
        amount_cents = parseAmount(montantRaw);
      } catch {
        fail(`Ligne ${i + 1} : montant invalide « ${montantRaw} ».`);
        return null as never;
      }
      lignes.push({ id, type: 'depense', date, nature, amount_cents, distance_km_dixiemes: null });
    }
  }
```

- [ ] **Step 2: Propager `id` dans `ResolvedLigne` / `resolveLignesWithRate`**

Interface `ResolvedLigne` (ligne ~173), ajouter `id` :

```ts
export interface ResolvedLigne {
  id: string | null;
  type: 'depense' | 'km';
  date: string;
  nature: string;
  amount_cents: number;
  distance_km_dixiemes: number | null;
  taux_km_millicents: number | null;
}
```

Dans `resolveLignesWithRate`, reporter `id: l.id` dans les deux branches :

```ts
  return lignes.map((l) =>
    l.type === 'km'
      ? {
          id: l.id,
          type: 'km' as const,
          date: l.date,
          nature: l.nature,
          amount_cents: computeKmAmountCents(l.distance_km_dixiemes ?? 0, tauxKmMillicents),
          distance_km_dixiemes: l.distance_km_dixiemes,
          taux_km_millicents: tauxKmMillicents,
        }
      : {
          id: l.id,
          type: 'depense' as const,
          date: l.date,
          nature: l.nature,
          amount_cents: l.amount_cents,
          distance_km_dixiemes: null,
          taux_km_millicents: null,
        },
  );
```

- [ ] **Step 3: Remplacer DELETE+addLigne par `reconcileLignes` dans `update.ts`**

Dans `web/src/lib/actions/remboursements/update.ts`, remplacer l'import :

```ts
import { getRemboursement, reconcileLignes } from '../../services/remboursements';
```

(retirer `addLigne` de l'import s'il n'est plus utilisé ailleurs dans le fichier — vérifier : il n'est utilisé que dans le bloc ci-dessous).

Puis remplacer le bloc lignes 102-112 :

```ts
  await getDb().prepare('DELETE FROM remboursement_lignes WHERE remboursement_id = ?').run(id);
  for (const l of resolvedLignes) {
    await addLigne(id, {
      date_depense: l.date,
      amount_cents: l.amount_cents,
      nature: l.nature,
      type: l.type,
      distance_km_dixiemes: l.distance_km_dixiemes,
      taux_km_millicents: l.taux_km_millicents,
    });
  }
```

par :

```ts
  await reconcileLignes(id, resolvedLignes.map((l) => ({
    id: l.id,
    date_depense: l.date,
    amount_cents: l.amount_cents,
    nature: l.nature,
    type: l.type,
    distance_km_dixiemes: l.distance_km_dixiemes,
    taux_km_millicents: l.taux_km_millicents,
  })));
```

- [ ] **Step 4: Vérifier le build**

Run: `cd web && pnpm build`
Expected: build OK. Si `addLigne` devient un import inutilisé ailleurs, l'ESLint/TS le signalera → le retirer de la ligne d'import.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/remboursements/_helpers.ts web/src/lib/actions/remboursements/update.ts
git commit -m "feat(rembs): édition via reconcileLignes (transmission des id de lignes)"
```

---

### Task 5: Tri par date dans le formulaire + transmission des `id`

**Files:**
- Modify: `web/src/components/rembs/remboursement-form.tsx`
- Modify: `web/src/app/(app)/remboursements/[id]/edit/page.tsx:93-99` (passer `id` dans `initialLignes`)

**Interfaces:**
- Consumes: `initialLignes` gagne un champ optionnel `id?: string`.
- Produces: le form émet un champ caché `ligne_{i}_id` (lu par `parseLignesFromForm`, Task 4) et affiche les lignes triées par date croissante (date vide en dernier).

- [ ] **Step 1: Passer l'`id` des lignes existantes depuis la page d'édition**

Dans `web/src/app/(app)/remboursements/[id]/edit/page.tsx`, le mapping `initialLignes` (lignes 93-99) :

```tsx
        initialLignes={lignes.map((l) => ({
          id: l.id,
          date_depense: l.date_depense,
          amount_cents: l.amount_cents,
          nature: l.nature,
          type: l.type === 'km' ? 'km' : 'depense',
          distance_km_dixiemes: l.distance_km_dixiemes,
        }))}
```

- [ ] **Step 2: Étendre les types + `newRow` du formulaire pour porter l'`id`**

Dans `web/src/components/rembs/remboursement-form.tsx` :

Interface `InitialLigne` (ligne ~33) — ajouter `id` :

```ts
interface InitialLigne {
  id?: string;
  date_depense: string;
  amount_cents: number;
  nature: string;
  type?: 'depense' | 'km';
  distance_km_dixiemes?: number | null;
}
```

Interface `Ligne` (ligne ~67) — ajouter `dbId` :

```ts
interface Ligne {
  key: number;
  dbId: string | null;
  type: 'depense' | 'km';
  date: string;
  montant: string; // dépense
  km: string;      // kilométrique (saisie km)
  nature: string;
}
```

`newRow` (ligne ~77) — reporter l'id :

```ts
function newRow(today: string, init?: InitialLigne): Ligne {
  if (init) {
    const type = init.type === 'km' ? 'km' : 'depense';
    return {
      key: ++_rowSeq,
      dbId: init.id ?? null,
      type,
      date: init.date_depense,
      montant: type === 'depense' ? (init.amount_cents / 100).toFixed(2).replace('.', ',') : '',
      km: type === 'km' && init.distance_km_dixiemes != null
        ? (init.distance_km_dixiemes / 10).toString().replace('.', ',')
        : '',
      nature: init.nature,
    };
  }
  return { key: ++_rowSeq, dbId: null, type: 'depense', date: today, montant: '', km: '', nature: '' };
}
```

- [ ] **Step 3: Trier l'affichage par date + émettre le champ caché `ligne_{i}_id`**

Toujours dans `remboursement-form.tsx`, juste avant le `return (` du composant (après `removeLigne`, ligne ~146), calculer la vue triée :

```ts
  // Affichage trié par date croissante (date vide → en dernier, pour ne
  // pas faire sauter une ligne en cours de saisie). L'ordre d'index i des
  // champs `ligne_{i}_*` = l'ordre de rendu ; `parseLignesFromForm` lit
  // par index, donc trier la vue est sans impact sur la soumission.
  const sortedLignes = [...lignes].sort((a, b) => {
    const da = a.date || '￿';
    const db = b.date || '￿';
    if (da !== db) return da < db ? -1 : 1;
    return a.key - b.key;
  });
```

Puis, dans le JSX de la section « Détail des dépenses », remplacer `{lignes.map((l, i) => {` par `{sortedLignes.map((l, i) => {` et, juste après l'ouverture de la `<div key={l.key} ...>`, ajouter le champ caché de l'id (à côté du `<input type="hidden" name={\`ligne_${i}_type\`} ...>` existant) :

```tsx
              <input type="hidden" name={`ligne_${i}_id`} value={l.dbId ?? ''} />
```

(placer cette ligne juste après la balise `<div key={l.key} ...>` d'ouverture, avant le premier `<Field label="Type" ...>`.)

- [ ] **Step 4: Vérifier le build**

Run: `cd web && pnpm build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/rembs/remboursement-form.tsx "web/src/app/(app)/remboursements/[id]/edit/page.tsx"
git commit -m "feat(rembs): formulaire — lignes triées par date + id transmis pour réconciliation"
```

---

### Task 6: Server action d'affectation (trésorier)

**Files:**
- Create: `web/src/lib/actions/remboursements/assign-justif.ts`
- Modify: `web/src/lib/actions/remboursements/index.ts` (ré-export, si le dossier a un baromètre d'index — sinon import direct)

**Interfaces:**
- Consumes: `setJustificatifLignes` (Task 2), `getCurrentContext`, `ADMIN_ROLES`.
- Produces: `assignJustifToLignes(remboursementId: string, justificatifId: string, formData: FormData): Promise<void>` — server action ; lit `formData.getAll('ligne_ids')`, vérifie le rôle admin, appelle `setJustificatifLignes`, `revalidatePath`.

- [ ] **Step 1: Vérifier la présence d'un index d'actions**

Run: `cd web && sed -n '1,40p' src/lib/actions/remboursements/index.ts 2>/dev/null || echo "PAS D INDEX"`
Expected: soit le contenu de l'index (barrel des server actions), soit « PAS D INDEX ». Cela détermine le Step 3.

- [ ] **Step 2: Créer la server action**

Créer `web/src/lib/actions/remboursements/assign-justif.ts` :

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../../context';
import { setJustificatifLignes } from '../../services/remboursement-justifs';
import { ADMIN_ROLES } from './_helpers';

// Affecte un justif de la demande à une sélection de lignes de détail
// (cases à cochées côté trésorier). `ligne_ids` = les lignes couvertes ;
// absence de sélection = on retire toutes les affectations du justif.
// Réservé aux admins (trésorier / RG).
export async function assignJustifToLignes(
  remboursementId: string,
  justificatifId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Action réservée au trésorier.');
  }
  const ligneIds = formData
    .getAll('ligne_ids')
    .filter((v): v is string => typeof v === 'string');
  await setJustificatifLignes({ groupId: ctx.groupId }, remboursementId, justificatifId, ligneIds);
  revalidatePath(`/remboursements/${remboursementId}`);
}
```

- [ ] **Step 3: Exposer l'action**

Si le Step 1 a montré un barrel `index.ts`, y ajouter :

```ts
export { assignJustifToLignes } from './assign-justif';
```

Sinon (pas d'index), la page importera directement depuis `@/lib/actions/remboursements/assign-justif` (aucune modif ici).

- [ ] **Step 4: Vérifier le build**

Run: `cd web && pnpm build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/actions/remboursements/assign-justif.ts web/src/lib/actions/remboursements/index.ts 2>/dev/null; git add web/src/lib/actions/remboursements/assign-justif.ts
git commit -m "feat(rembs): server action d'affectation justif↔lignes (admin)"
```

---

### Task 7: UI — tableau de détail client (tri + pastilles) + contrôle d'affectation + couverture

**Files:**
- Create: `web/src/components/rembs/detail-depenses-table.tsx`
- Modify: `web/src/app/(app)/remboursements/[id]/page.tsx` (charger assignations, rendre le tableau client, ajouter le contrôle d'affectation dans la carte Justificatifs)

**Interfaces:**
- Consumes: `listAssignationsLignes`, `computeCouverture` (Task 2) ; `assignJustifToLignes` (Task 6) ; `RemboursementLigne` (type existant).
- Produces: composant client `DetailDepensesTable`.

- [ ] **Step 1: Créer le composant client `DetailDepensesTable`**

Créer `web/src/components/rembs/detail-depenses-table.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, TriangleAlert, Paperclip } from 'lucide-react';
import { Amount } from '@/components/shared/amount';
import { formatKmRate, formatDistance } from '@/lib/services/km';
import { cn } from '@/lib/utils';

export interface DetailLigne {
  id: string;
  date_depense: string;
  amount_cents: number;
  nature: string;
  type: string;
  distance_km_dixiemes: number | null;
  taux_km_millicents: number | null;
}

export interface JustifRef {
  id: string;
  original_filename: string;
  file_path: string;
}

type SortCol = 'date' | 'montant';
type SortDir = 'asc' | 'desc';

export function DetailDepensesTable({
  lignes,
  justifsParLigne,
}: {
  lignes: DetailLigne[];
  // map ligne_id → justifs rattachés
  justifsParLigne: Record<string, JustifRef[]>;
}) {
  const [col, setCol] = useState<SortCol>('date');
  const [dir, setDir] = useState<SortDir>('asc');

  const toggle = (c: SortCol) => {
    if (c === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setCol(c); setDir('asc'); }
  };

  const sorted = [...lignes].sort((a, b) => {
    const mult = dir === 'asc' ? 1 : -1;
    if (col === 'montant') return (a.amount_cents - b.amount_cents) * mult;
    if (a.date_depense !== b.date_depense) return a.date_depense < b.date_depense ? -mult : mult;
    return 0;
  });

  const Arrow = ({ c }: { c: SortCol }) =>
    c === col ? (
      dir === 'asc' ? <ArrowUp size={11} strokeWidth={2} className="inline" /> : <ArrowDown size={11} strokeWidth={2} className="inline" />
    ) : null;

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-soft text-[11px] uppercase tracking-wide text-fg-subtle">
            <th className="py-2 px-2 text-left font-medium">
              <button type="button" onClick={() => toggle('date')} className="inline-flex items-center gap-1 hover:text-fg">
                Date <Arrow c="date" />
              </button>
            </th>
            <th className="py-2 px-2 text-left font-medium">Nature</th>
            <th className="py-2 px-2 text-left font-medium">Justif</th>
            <th className="py-2 px-2 text-right font-medium">
              <button type="button" onClick={() => toggle('montant')} className="inline-flex items-center gap-1 hover:text-fg">
                Montant <Arrow c="montant" />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const justifs = justifsParLigne[l.id] ?? [];
            const ok = justifs.length > 0;
            return (
              <tr key={l.id} className="border-b border-border-soft last:border-b-0 align-top">
                <td className="py-2 px-2 text-fg tabular-nums">{l.date_depense}</td>
                <td className="py-2 px-2 text-fg">
                  {l.nature}
                  {l.type === 'km' && l.distance_km_dixiemes != null && l.taux_km_millicents != null && (
                    <span className="block text-[11.5px] text-fg-subtle tabular-nums">
                      {formatDistance(l.distance_km_dixiemes)} × {formatKmRate(l.taux_km_millicents)}/km
                    </span>
                  )}
                </td>
                <td className="py-2 px-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border',
                      ok
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
                    )}
                  >
                    {ok ? <Check size={11} strokeWidth={2.5} /> : <TriangleAlert size={11} strokeWidth={2.25} />}
                    {ok ? 'Justif' : 'Manquant'}
                  </span>
                  {justifs.map((j) => (
                    <a
                      key={j.id}
                      href={`/api/justificatifs/${j.file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="mt-1 flex items-center gap-1 text-[11.5px] text-fg-muted hover:text-brand transition-colors"
                    >
                      <Paperclip size={10} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
                      <span className="truncate max-w-[160px]">{j.original_filename}</span>
                    </a>
                  ))}
                </td>
                <td className="py-2 px-2 text-right font-medium">
                  <Amount cents={l.amount_cents} tone="negative" />
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

- [ ] **Step 2: Charger les assignations et calculer la couverture dans la page**

Dans `web/src/app/(app)/remboursements/[id]/page.tsx` :

Ajouter les imports :

```ts
import { listAssignationsLignes, computeCouverture } from '@/lib/services/remboursement-justifs';
import { DetailDepensesTable } from '@/components/rembs/detail-depenses-table';
import { assignJustifToLignes } from '@/lib/actions/remboursements/assign-justif';
```

Ajouter `listAssignationsLignes(id)` au `Promise.all` (ligne 70-81) et récupérer le résultat :

```ts
  const [sp, ctx, r, lignes, justificatifs, feuilles, ribFiles, signatures, chain, assignations] =
    await Promise.all([
      searchParams,
      getCurrentContext(),
      getRemboursement(id),
      listLignes(id),
      listJustificatifs('remboursement', id),
      listJustificatifs('remboursement_feuille', id),
      listJustificatifs('remboursement_rib', id),
      listSignatures('remboursement', id),
      verifyChain('remboursement', id),
      listAssignationsLignes(id),
    ]);
```

Après `if (!r) notFound();`, construire les maps (dérivées, pas d'I/O) :

```ts
  // justif_id → ligne_ids et ligne_id → [justifs] (pour pastilles + cases).
  const couverture = computeCouverture(lignes, assignations);
  const justifsParLigne: Record<string, { id: string; original_filename: string; file_path: string }[]> = {};
  const lignesParJustif: Record<string, Set<string>> = {};
  for (const a of assignations) {
    const j = justificatifs.find((x) => x.id === a.justificatif_id);
    if (j) {
      (justifsParLigne[a.ligne_id] ??= []).push({
        id: j.id,
        original_filename: j.original_filename,
        file_path: j.file_path,
      });
    }
    (lignesParJustif[a.justificatif_id] ??= new Set()).add(a.ligne_id);
  }
```

- [ ] **Step 3: Remplacer le tableau statique par le composant client + titre avec couverture**

Remplacer la `<Section title={\`Détail des dépenses (${lignes.length})\`} ...>` et tout le bloc `<div className="overflow-x-auto -mx-2"><table>...</table></div>` (lignes 190-233) par :

```tsx
          <Section
            title={`Détail des dépenses (${lignes.length})`}
            subtitle={
              lignes.length > 0
                ? `${couverture.justifiees}/${couverture.total} détail${couverture.total > 1 ? 's' : ''} justifié${couverture.justifiees > 1 ? 's' : ''}`
                : undefined
            }
            action={
              <div className="text-right">
                <div className="text-overline text-fg-subtle">Total</div>
                <div className="text-display-sm tabular-nums text-fg">
                  <Amount cents={totalCents} tone="negative" />
                </div>
              </div>
            }
          >
            <DetailDepensesTable lignes={lignes} justifsParLigne={justifsParLigne} />
          </Section>
```

- [ ] **Step 4: Ajouter le contrôle d'affectation dans la carte « Justificatifs » (admin)**

Dans la carte `<Section title={\`Justificatifs (${justificatifs.length})\`}>` (aside, lignes ~346-369), remplacer la `<ul>` listant les justifs par une version où chaque justif porte, pour un admin, un `<details>` avec les cases à cocher des lignes. Remplacer le bloc :

```tsx
            {justificatifs.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">Aucun justificatif.</p>
            ) : (
              <ul className="space-y-1">
                {justificatifs.map((j) => (
                  <li key={j.id}>
                    <a
                      href={`/api/justificatifs/${j.file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
                    >
                      <Paperclip
                        size={13}
                        className="shrink-0 text-fg-subtle"
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{j.original_filename}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
```

par :

```tsx
            {justificatifs.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted italic">Aucun justificatif.</p>
            ) : (
              <ul className="space-y-1">
                {justificatifs.map((j) => (
                  <li key={j.id}>
                    <a
                      href={`/api/justificatifs/${j.file_path}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-fg hover:bg-brand-50 hover:text-brand transition-colors"
                    >
                      <Paperclip size={13} className="shrink-0 text-fg-subtle" strokeWidth={1.75} />
                      <span className="truncate">{j.original_filename}</span>
                    </a>
                    {isAdmin && lignes.length > 0 && (
                      <details className="ml-6 mt-0.5">
                        <summary className="cursor-pointer text-[11.5px] text-fg-subtle hover:text-fg-muted transition-colors">
                          Rattacher à des lignes ({(lignesParJustif[j.id]?.size ?? 0)})
                        </summary>
                        <form
                          action={assignJustifToLignes.bind(null, id, j.id)}
                          className="mt-1.5 space-y-1.5 rounded-md border border-border-soft bg-bg-sunken/40 px-2.5 py-2"
                        >
                          {lignes.map((l) => (
                            <label key={l.id} className="flex items-start gap-2 text-[12px] text-fg cursor-pointer">
                              <input
                                type="checkbox"
                                name="ligne_ids"
                                value={l.id}
                                defaultChecked={lignesParJustif[j.id]?.has(l.id) ?? false}
                                className="mt-0.5 h-3.5 w-3.5 rounded border-border-strong text-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                              />
                              <span className="tabular-nums">
                                {l.date_depense} · {l.nature} · {(l.amount_cents / 100).toFixed(2).replace('.', ',')} €
                              </span>
                            </label>
                          ))}
                          <div className="flex justify-end pt-1">
                            <PendingButton variant="outline" size="sm">
                              Enregistrer
                            </PendingButton>
                          </div>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
```

- [ ] **Step 5: Vérifier le build**

Run: `cd web && pnpm build`
Expected: build OK.

- [ ] **Step 6: Smoke test manuel (dev)**

Run: `cd web && pnpm dev` puis, connecté en trésorier, ouvrir une demande de remboursement multi-lignes avec au moins un justif.
Vérifier :
- Le tableau « Détail des dépenses » se trie au clic sur « Date » et « Montant » (↑/↓).
- Chaque ligne affiche « Manquant » (ambre) tant qu'aucun justif n'est rattaché.
- Dans la carte Justificatifs, « Rattacher à des lignes » ouvre les cases ; cocher une/plusieurs lignes + Enregistrer → la pastille passe à « Justif » (vert) et le nom du fichier apparaît sous la ligne ; le sous-titre passe à « X/Y détails justifiés ».
- Éditer la demande (Modifier) sans changer les lignes puis revenir : les rattachements sont conservés (ids préservés).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/rembs/detail-depenses-table.tsx "web/src/app/(app)/remboursements/[id]/page.tsx"
git commit -m "feat(rembs): tableau détail triable + pastilles justif + affectation aux lignes"
```

---

## Self-Review

**Spec coverage :**
- Bloc 1 tri formulaire → Task 5. Tri affichage interactif → Task 7 (Step 1/3). ✅
- Bloc 2 prérequis id stables (reconcileLignes) → Task 3 ; branchement édition → Task 4. Table de liaison → Task 1. ✅
- Bloc 3 services (listAssignations, setJustificatifLignes, computeCouverture) → Task 2. ✅
- Bloc 4 UI (pastilles, contrôle d'affectation, couverture) → Task 7. ✅
- Hors scope respecté : pas d'upload par ligne, rien côté demandeur, pas de MCP. ✅

**Placeholders :** aucun TODO/TBD ; tout le code est fourni.

**Cohérence des types :** `ReconcileLigneInput` (Task 3) consommé par Task 4 avec les mêmes champs. `LigneJustifAssignation.ligne_id` / `computeCouverture` (Task 2) consommés par Task 7. `DetailLigne` de Task 7 est un sous-ensemble de `RemboursementLigne` — la page passe `lignes` (type `RemboursementLigne[]`) qui a tous les champs requis. `assignJustifToLignes(remboursementId, justificatifId, formData)` (Task 6) appelé via `.bind(null, id, j.id)` en Task 7 : signature cohérente.

**Note de risque (signature électronique) :** l'action d'édition (`updateMyRemboursement`) re-signe systématiquement en « demandeur » et purge les signatures à chaque édition (comportement existant, inchangé). `reconcileLignes` ne modifie pas ce flux ; il le rend juste plus propre (ids stables). Aucune régression attendue sur `computeRemboursementHash` (inchangé).
