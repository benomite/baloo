# Auto-ventilation d'un virement groupé — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand on lie/délie N demandes de remboursement à une écriture de virement (draft), découper automatiquement l'écriture en N sous-lignes (une par demande, sur son unité) + une ligne « reste à imputer », pour que les budgets par unité soient justes.

**Architecture :** Un nouveau helper `syncEcritureVentilationFromRembs` construit les lignes de ventilation depuis les demandes liées et délègue au moteur existant `ventilateDraft` (dont on assouplit le garde-fou de complétude). `setRembsEcritureLink` l'appelle en best-effort à chaque lien/délien. Les remboursements restent épinglés à la tête du groupe de ventilation ; les indicateurs de couverture lisent le total du groupe.

**Tech Stack :** TypeScript, Next 16, libsql/Turso, vitest (in-memory `file::memory:?cache=shared`).

## Global Constraints

- **Jamais de DELETE de données métier** : les enfants de ventilation sont supprimés uniquement via `deleteDraftEcriture` (garde-fous stricts : draft + aucune pièce). Les remboursements ne sont jamais réaffectés ni déliés par ce code.
- **`amount_cents` est stocké POSITIF** (le signe dépense/recette est un affichage) — toutes les lignes de ventilation sont positives et somment au montant positif de la tête.
- **`categories` n'a pas de `group_id`** (référentiel national) — non concerné ici, mais ne jamais filtrer categories par group_id.
- **Best-effort non bloquant** : une erreur de ventilation ne doit jamais faire échouer la liaison — try/catch + `logError`.
- **Tests avec transaction** : `ventilateDraft` ouvre une transaction libsql → les tests qui l'appellent DOIVENT utiliser `file::memory:?cache=shared` + création du schéma UNE fois en `beforeAll` (cf. `ecritures-ventilate.test.ts`), sinon la connexion de transaction pointe vers une base vide.
- **Pas de push sans accord explicite.**
- Lancer les tests : `pnpm test` (= `vitest run`) depuis `web/`.

---

### Task 1 : Assouplir le garde-fou de complétude de `ventilateDraft`

**Files:**
- Modify: `web/src/lib/services/ecritures-ventilate.ts:70-73`
- Test: `web/src/lib/services/__tests__/ecritures-ventilate.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `ventilateDraft(ctx, headId, ventilations)` accepte désormais des lignes à `category_id`/`unite_id`/`activite_id` nuls (seul `amount_cents !== 0` reste requis). Signature et retour (`VentilateDraftResult`) inchangés.

- [ ] **Step 1 : Écrire le test qui échoue** — ajouter dans `describe('ventilateDraft', ...)` :

```ts
it('accepte des lignes à catégorie/activité/unité nulles (draft incomplet toléré)', async () => {
  const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [
    { amount_cents: 700, category_id: null, unite_id: null, activite_id: null },
    { amount_cents: 364, category_id: null, unite_id: null, activite_id: null },
  ]);
  expect(res.ok).toBe(true);
  expect(res.ids).toHaveLength(2);
});

it('refuse toujours une ligne à montant nul', async () => {
  const res = await ventilateDraft({ groupId: 'g1' }, 'E1', [
    { amount_cents: 1064, category_id: null, unite_id: null, activite_id: null },
    { amount_cents: 0, category_id: null, unite_id: null, activite_id: null },
  ]);
  expect(res).toMatchObject({ ok: false, reason: 'incomplete' });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run : `pnpm test ecritures-ventilate`
Expected : le 1er nouveau test échoue (`reason: 'incomplete'` alors qu'on attend `ok: true`).

- [ ] **Step 3 : Implémenter le changement minimal** — remplacer lignes 70-73 :

```ts
  // Un draft est incomplet par nature : seule contrainte, un montant non nul.
  // La complétude catégorie/unité/activité est exigée côté UI (panneau manuel,
  // `canSaveVentilation`) et à la validation vers Comptaweb, pas ici.
  const incomplete = ventilations.some((v) => v.amount_cents === 0);
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run : `pnpm test ecritures-ventilate`
Expected : PASS (tous, y compris le test historique `refuse une ventilation incomplète` qui utilise `amount_cents: 700` non nul → n'est plus refusé ; **le supprimer ou le convertir** : voir Step 5).

- [ ] **Step 5 : Adapter le test historique devenu faux** — le test `refuse une ventilation incomplète` (lignes ~110-115) attendait `incomplete` pour une ligne à cat nulle mais montant 700. Ce n'est plus le comportement. Le remplacer par le test « montant nul » du Step 1 (supprimer l'ancien s'il fait doublon).

- [ ] **Step 6 : Commit**

```bash
git add web/src/lib/services/ecritures-ventilate.ts web/src/lib/services/__tests__/ecritures-ventilate.test.ts
git commit -m "feat(rembs): ventilateDraft tolère les lignes d'imputation nulles sur un draft"
```

---

### Task 2 : Helper `syncEcritureVentilationFromRembs`

**Files:**
- Modify: `web/src/lib/services/remboursement-ecriture-link.ts` (ajout de la fonction + imports)
- Test: `web/src/lib/services/__tests__/remboursement-auto-ventilation.test.ts` (créer)

**Interfaces:**
- Consumes: `ventilateDraft(ctx, headId, VentilationInput[])` (Task 1), `EcritureContext` (`./ecritures`), `VentilationInput` (`./ecritures-create`), `currentTimestamp` (`../ids`).
- Produces:
  ```ts
  export async function syncEcritureVentilationFromRembs(
    groupId: string,
    ecritureId: string,
  ): Promise<void>;
  ```
  (Task 3 l'appelle.)

- [ ] **Step 1 : Créer le fichier de test qui échoue** — `web/src/lib/services/__tests__/remboursement-auto-ventilation.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let testClient: Client;
let idCounter = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextIdOn: async (_db: unknown, p: string) => `${p}-${++idCounter}`,
  nextId: async (p: string) => `${p}-${++idCounter}`,
  currentTimestamp: () => '2026-07-24T10:00:00Z',
}));

import { syncEcritureVentilationFromRembs } from '../remboursement-ecriture-link';

// Transaction libsql → schéma créé une seule fois, cache partagé (cf. ecritures-ventilate.test.ts).
beforeAll(async () => {
  testClient = createClient({ url: 'file::memory:?cache=shared' });
  await testClient.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(testClient);
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT,
      mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT, carte_id TEXT,
      justif_attendu INTEGER DEFAULT 1, notes TEXT, ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER, libelle_origine TEXT,
      ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
      status TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER,
      unite_id TEXT, ecriture_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, group_id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
  `);
});
afterAll(async () => { await testClient.close(); });

// Virement draft de 470,32 € (47032 c) + demandes liées paramétrables.
async function seedVirement(amount = 47032): Promise<void> {
  idCounter = 0;
  await testDb.exec('DELETE FROM ecritures; DELETE FROM remboursements;');
  await testDb.prepare(
    `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, created_at, updated_at)
     VALUES ('ECR','g','2026-07-20','VIREMENT FLORENCE',?, 'depense','draft','t','t')`,
  ).run(amount);
}
async function addRemb(id: string, total: number, unite: string | null, created: string): Promise<void> {
  await testDb.prepare(
    `INSERT INTO remboursements (id, group_id, amount_cents, total_cents, unite_id, ecriture_id, created_at)
     VALUES (?,?,?,?,?,'ECR',?)`,
  ).run(id, 'g', total, total, unite, created);
}
async function lignes(): Promise<Array<{ id: string; amount_cents: number; unite_id: string | null; vg: string | null }>> {
  return await testDb.prepare(
    'SELECT id, amount_cents, unite_id, ventilation_group_id AS vg FROM ecritures WHERE group_id=? ORDER BY amount_cents DESC',
  ).all<{ id: string; amount_cents: number; unite_id: string | null; vg: string | null }>('g');
}

describe('syncEcritureVentilationFromRembs', () => {
  beforeEach(async () => { await seedVirement(); });

  it('2 demandes couvrant exactement → 2 lignes sur leurs unités, tête préservée', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 17032, 'u-far', '2026-07-02');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount_cents).sort((a, b) => a - b)).toEqual([17032, 30000]);
    expect(rows.every((r) => r.vg && r.vg === rows[0].vg)).toBe(true);
    expect(rows.some((r) => r.id === 'ECR')).toBe(true); // tête réutilisée
    expect(rows.map((r) => r.unite_id).sort()).toEqual(['u-far', 'u-lj']);
  });

  it('sous-couverture → lignes demandes + ligne « reste »', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(2); // R1 (30000) + reste (17032)
    expect(rows.map((r) => r.amount_cents).sort((a, b) => a - b)).toEqual([17032, 30000]);
    const reste = rows.find((r) => r.amount_cents === 17032)!;
    expect(reste.unite_id).toBeNull();
  });

  it('dépassement → aucune ventilation, écriture inchangée', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 25000, 'u-far', '2026-07-02'); // 55000 > 47032
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(47032);
    expect(rows[0].vg).toBeNull();
  });

  it('délien 2→1 (exact) → repli en mono-ligne, enfants supprimés', async () => {
    await addRemb('R1', 47032, 'u-lj', '2026-07-01');
    await addRemb('R2', 0, 'u-far', '2026-07-02'); // placeholder retiré ensuite
    // simulate 2 puis retrait de R2 : on relie R2 avec un montant réel puis on le retire
    await testDb.prepare("UPDATE remboursements SET total_cents=17000, amount_cents=17000 WHERE id='R2'").run();
    await testDb.prepare("UPDATE remboursements SET total_cents=30032, amount_cents=30032 WHERE id='R1'").run();
    await syncEcritureVentilationFromRembs('g', 'ECR'); // ventile en 2
    expect(await lignes()).toHaveLength(2);
    // retrait de R2
    await testDb.prepare("UPDATE remboursements SET ecriture_id=NULL WHERE id='R2'").run();
    await testDb.prepare("UPDATE remboursements SET total_cents=47032, amount_cents=47032 WHERE id='R1'").run();
    await syncEcritureVentilationFromRembs('g', 'ECR'); // repli
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('ECR');
    expect(rows[0].amount_cents).toBe(47032);
    expect(rows[0].unite_id).toBe('u-lj');
    expect(rows[0].vg).toBeNull();
  });

  it('demande unique jamais ventilée → COALESCE unité, pas de ventilation', async () => {
    await addRemb('R1', 47032, 'u-lj', '2026-07-01');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].vg).toBeNull();
    expect(rows[0].unite_id).toBe('u-lj');
  });

  it('COALESCE non destructif : une unité déjà posée n\'est pas écrasée', async () => {
    await testDb.prepare("UPDATE ecritures SET unite_id='u-deja' WHERE id='ECR'").run();
    await addRemb('R1', 47032, 'u-lj', '2026-07-01');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows[0].unite_id).toBe('u-deja');
  });

  it('écriture non-draft → no-op', async () => {
    await testDb.prepare("UPDATE ecritures SET status='mirror' WHERE id='ECR'").run();
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 17032, 'u-far', '2026-07-02');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    expect(await lignes()).toHaveLength(1);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run : `pnpm test remboursement-auto-ventilation`
Expected : FAIL — `syncEcritureVentilationFromRembs is not a function` (export absent).

- [ ] **Step 3 : Implémenter le helper** — dans `web/src/lib/services/remboursement-ecriture-link.ts`, ajouter en tête les imports puis la fonction :

```ts
import { ventilateDraft } from './ecritures-ventilate';
import type { EcritureContext } from './ecritures';
import type { VentilationInput } from './ecritures-create';
import { currentTimestamp } from '../ids';
```

```ts
// (Re)ventile une écriture de virement selon les demandes qui lui sont liées.
// Best-effort — appelée après chaque lien/délien. Grain canonique = la
// ventilation : une sous-ligne par demande (sur son unité) + une ligne « reste
// à imputer » si la somme des demandes < montant du virement.
//
// Invariant d'ancrage : les remboursements restent épinglés à la TÊTE du
// groupe (jamais réaffectés). `ventilateDraft` préserve l'id de tête, les
// enfants n'ont aucune pièce → re-ventilation possible sans casser le lien N→1.
export async function syncEcritureVentilationFromRembs(
  groupId: string,
  ecritureId: string,
): Promise<void> {
  const db = getDb();

  const ecr = await db
    .prepare(
      `SELECT amount_cents, status, comptaweb_ecriture_id, ventilation_group_id
       FROM ecritures WHERE id = ? AND group_id = ?`,
    )
    .get<{
      amount_cents: number;
      status: string;
      comptaweb_ecriture_id: number | null;
      ventilation_group_id: string | null;
    }>(ecritureId, groupId);

  // On ne touche jamais une écriture matérialisée dans Comptaweb.
  if (!ecr || ecr.status !== 'draft' || ecr.comptaweb_ecriture_id !== null) return;

  // Total du virement = Σ du groupe (la tête peut déjà porter une part), sinon
  // son propre montant. Invariant : Σ groupe = montant du virement d'origine.
  let virement = Math.abs(ecr.amount_cents);
  if (ecr.ventilation_group_id) {
    const g = await db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS t
         FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
      )
      .get<{ t: number }>(groupId, ecr.ventilation_group_id);
    virement = Math.abs(g?.t ?? ecr.amount_cents);
  }

  // Demandes liées, tri déterministe.
  const rembs = await db
    .prepare(
      `SELECT unite_id, COALESCE(total_cents, amount_cents) AS total
       FROM remboursements
       WHERE group_id = ? AND ecriture_id = ?
       ORDER BY created_at, id`,
    )
    .all<{ unite_id: string | null; total: number | null }>(groupId, ecritureId);

  const lignes: VentilationInput[] = rembs.map((r) => ({
    amount_cents: Math.abs(r.total ?? 0),
    unite_id: r.unite_id ?? null,
    category_id: null,
    activite_id: null,
  }));

  const somme = lignes.reduce((s, l) => s + l.amount_cents, 0);
  const reste = virement - somme;

  // Dépassement : on ne fabrique pas de ligne négative, on laisse tel quel.
  if (reste < 0) return;
  if (reste > 0) {
    lignes.push({ amount_cents: reste, unite_id: null, category_id: null, activite_id: null });
  }

  const ctx: EcritureContext = { groupId };

  if (lignes.length >= 2) {
    await ventilateDraft(ctx, ecritureId, lignes);
    return;
  }

  if (lignes.length === 1) {
    if (ecr.ventilation_group_id) {
      // Repli d'un groupe existant vers une mono-ligne.
      await ventilateDraft(ctx, ecritureId, lignes);
    } else {
      // Demande unique jamais ventilée : COALESCE unité (non destructif).
      const u = lignes[0].unite_id;
      if (u) {
        await db
          .prepare(
            `UPDATE ecritures SET unite_id = COALESCE(unite_id, ?), updated_at = ?
             WHERE id = ? AND group_id = ? AND status = 'draft'`,
          )
          .run(u, currentTimestamp(), ecritureId, groupId);
      }
    }
  }
  // lignes.length === 0 : virement à 0 sans demande → rien à faire.
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run : `pnpm test remboursement-auto-ventilation`
Expected : PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/remboursement-ecriture-link.ts web/src/lib/services/__tests__/remboursement-auto-ventilation.test.ts
git commit -m "feat(rembs): syncEcritureVentilationFromRembs — découpe auto d'un virement groupé"
```

---

### Task 3 : Câbler la (re)ventilation dans `setRembsEcritureLink`

**Files:**
- Modify: `web/src/lib/services/remboursement-ecriture-link.ts:95-123` (corps de `setRembsEcritureLink`)
- Test: `web/src/lib/services/__tests__/remboursement-auto-ventilation.test.ts` (ajout d'un describe), `web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts` (schéma de setup)

**Interfaces:**
- Consumes: `syncEcritureVentilationFromRembs` (Task 2), `logError` (`../log`, déjà importé par l'action ; ici importer dans le service).
- Produces: `setRembsEcritureLink` inchangé côté signature/retour ; effet de bord : ventile la cible en best-effort.

- [ ] **Step 1 : Écrire le test d'intégration qui échoue** — ajouter à `remboursement-auto-ventilation.test.ts` :

```ts
import { setRembsEcritureLink } from '../remboursement-ecriture-link';

describe('setRembsEcritureLink → ventilation auto', () => {
  beforeEach(async () => { await seedVirement(); });

  it('lier une 2e demande ventile le virement en 2 lignes', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01'); // déjà liée
    // R2 pas encore liée (ecriture_id NULL)
    await testDb.prepare(
      "INSERT INTO remboursements (id, group_id, amount_cents, total_cents, unite_id, created_at) VALUES ('R2','g',17032,17032,'u-far','2026-07-02')",
    ).run();
    const res = await setRembsEcritureLink('g', 'R2', 'ECR');
    expect(res.ok).toBe(true);
    const rows = await lignes();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount_cents).sort((a, b) => a - b)).toEqual([17032, 30000]);
  });

  it('délier la 2e demande replie en mono-ligne', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 17032, 'u-far', '2026-07-02');
    await syncEcritureVentilationFromRembs('g', 'ECR'); // ventilé en 2
    expect(await lignes()).toHaveLength(2);
    const res = await setRembsEcritureLink('g', 'R2', null); // délien
    expect(res.ok).toBe(true);
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(47032);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run : `pnpm test remboursement-auto-ventilation`
Expected : FAIL — après lien, `rows` a toujours 1 ligne (ventilation pas encore câblée).

- [ ] **Step 3 : Câbler + retirer le bloc COALESCE devenu redondant** — dans `setRembsEcritureLink`, remplacer tout le bloc d'enrichissement `unite_id` (lignes ~103-121, du commentaire `// Enrichissement :` jusqu'à la fin du `if (ecritureId) { ... }`) par un appel best-effort à la ventilation, sur la cible (écriture liée, ou l'écriture précédente en cas de délien) :

```ts
  // (Re)ventilation auto du virement selon ses demandes liées. Best-effort :
  // une erreur ici ne doit jamais faire échouer la liaison. Absorbe l'ancien
  // enrichissement COALESCE `unite_id` (cas « demande unique jamais ventilée »).
  const target = ecritureId ?? current.ecriture_id;
  if (target) {
    try {
      await syncEcritureVentilationFromRembs(groupId, target);
    } catch (err) {
      logError('remboursements', 'Ventilation auto du virement échouée', err);
    }
  }

  return { ok: true, previous: current.ecriture_id };
```

Ajouter l'import en tête du fichier : `import { logError } from '../log';`

- [ ] **Step 4 : Mettre à jour le schéma du test existant** — dans `remboursement-ecriture-link.test.ts`, ajouter à la table `ecritures` du `SETUP` (ligne ~19-22) les colonnes lues par la ventilation, pour éviter un `no such column` bruyant (même si sync early-return sur `status='mirror'`) :

```ts
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT, type TEXT, amount_cents INTEGER,
    date_ecriture TEXT, description TEXT, unite_id TEXT, status TEXT,
    ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
    category_id TEXT, activite_id TEXT, mode_paiement_id TEXT, numero_piece TEXT,
    carte_id TEXT, justif_attendu INTEGER, notes TEXT, ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER, libelle_origine TEXT, created_at TEXT, updated_at TEXT
  );
```

Et ajouter `created_at` à la table `remboursements` du même SETUP (colonne triée par la ventilation) :

```ts
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER,
    date_depense TEXT, unite_id TEXT, ecriture_id TEXT, created_at TEXT, updated_at TEXT
  );
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run : `pnpm test remboursement`
Expected : PASS (auto-ventilation + link + coverage + convert + justifs + reconcile).

- [ ] **Step 6 : Commit**

```bash
git add web/src/lib/services/remboursement-ecriture-link.ts web/src/lib/services/__tests__/remboursement-auto-ventilation.test.ts web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts
git commit -m "feat(rembs): setRembsEcritureLink (re)ventile le virement à chaque lien/délien"
```

---

### Task 4 : Couverture group-aware + masquer les sous-lignes des candidats

**Files:**
- Modify: `web/src/lib/services/remboursement-ecriture-link.ts` (`getEcritureRembsCoverage` + `findEcritureCandidatesForRembs`)
- Test: `web/src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts`, `web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts`

**Interfaces:**
- Consumes: `computeRembsCoverage` (existant, pur).
- Produces: `getEcritureRembsCoverage` dénominateur = total du groupe de ventilation ; `findEcritureCandidatesForRembs` n'émet plus les lignes-enfants.

- [ ] **Step 1 : Écrire les tests qui échouent** — dans `remboursement-ecriture-coverage.test.ts`, étendre le setup (ajouter la colonne `ventilation_group_id`) et un cas groupe :

```ts
// dans beforeEach : remplacer le CREATE TABLE ecritures par :
//   CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, ventilation_group_id TEXT);
// puis, après les INSERT existants, ajouter un virement ventilé :
await testDb.prepare("INSERT INTO ecritures (id, group_id, amount_cents, ventilation_group_id) VALUES ('H','g',30000,'vg1')").run();
await testDb.prepare("INSERT INTO ecritures (id, group_id, amount_cents, ventilation_group_id) VALUES ('C','g',17032,'vg1')").run();
await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('RA','g',30000,30000,'H')").run();
await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('RB','g',17032,17032,'H')").run();
```

```ts
it('après ventilation : dénominateur = total du groupe, pas la part de la tête', async () => {
  const c = await getEcritureRembsCoverage('g', 'H');
  expect(c.montantVirementCents).toBe(47032); // 30000 + 17032, pas 30000
  expect(c.sommeDemandesCents).toBe(47032);
  expect(c.resteCents).toBe(0);
  expect(c.depasse).toBe(false);
});
```

Dans `remboursement-ecriture-link.test.ts` (`describe('findEcritureCandidatesForRembs')`), ajouter une sous-ligne enfant et vérifier qu'elle est masquée :

```ts
it('masque les lignes-enfants de ventilation (sans remb liée)', async () => {
  await testDb.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status, ventilation_group_id) VALUES ('ECR-CHILD','g','depense',5000,'2026-07-01','Enfant ventil','draft','vgX')",
  ).run();
  const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
  expect(c.map((x) => x.id)).not.toContain('ECR-CHILD');
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run : `pnpm test remboursement-ecriture-coverage remboursement-ecriture-link`
Expected : FAIL — coverage renvoie 30000 (part de tête) ; `ECR-CHILD` apparaît dans les candidats.

- [ ] **Step 3 : Implémenter** — dans `getEcritureRembsCoverage`, lire le vg et sommer le groupe :

```ts
export async function getEcritureRembsCoverage(
  groupId: string,
  ecritureId: string,
): Promise<RembsCoverage> {
  const db = getDb();
  const ecr = await db
    .prepare('SELECT amount_cents, ventilation_group_id FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ amount_cents: number; ventilation_group_id: string | null }>(ecritureId, groupId);
  let virement = ecr?.amount_cents ?? 0;
  if (ecr?.ventilation_group_id) {
    const g = await db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS t FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?')
      .get<{ t: number }>(groupId, ecr.ventilation_group_id);
    virement = g?.t ?? virement;
  }
  const rows = await db
    .prepare(
      `SELECT COALESCE(total_cents, amount_cents) AS total
       FROM remboursements WHERE group_id = ? AND ecriture_id = ?`,
    )
    .all<{ total: number }>(groupId, ecritureId);
  return computeRembsCoverage(virement, rows.map((r) => r.total ?? 0));
}
```

Dans `findEcritureCandidatesForRembs`, ajouter à `conditions` (après la ligne `["e.group_id = ?", "e.type = 'depense'"]`) le filtre qui masque les enfants :

```ts
  conditions.push(
    "(e.ventilation_group_id IS NULL OR EXISTS (SELECT 1 FROM remboursements r WHERE r.ecriture_id = e.id))",
  );
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run : `pnpm test remboursement-ecriture-coverage remboursement-ecriture-link`
Expected : PASS.

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/remboursement-ecriture-link.ts web/src/lib/services/__tests__/remboursement-ecriture-coverage.test.ts web/src/lib/services/__tests__/remboursement-ecriture-link.test.ts
git commit -m "feat(rembs): couverture au niveau du groupe de ventilation + candidats sans sous-lignes"
```

---

### Task 5 : Bundle & carte — couverture côté écriture sur le total du groupe

**Files:**
- Modify: `web/src/lib/services/justificatifs.ts` (`EcritureJustifsBundle` + `listJustificatifsForEcriture`)
- Modify: `web/src/components/ecritures/justificatifs-card.tsx`
- Test: `web/src/lib/services/__tests__/justificatifs-bundle-ventilation.test.ts` (créer)

**Interfaces:**
- Consumes: `listJustificatifsForEcriture` (existant).
- Produces: `EcritureJustifsBundle.ventilationGroupTotalCents: number` (total du virement, = Σ groupe si ventilé, sinon montant propre) ; consommé par `JustificatifsCard` pour la couverture.

- [ ] **Step 1 : Écrire le test qui échoue** — `web/src/lib/services/__tests__/justificatifs-bundle-ventilation.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { listJustificatifsForEcriture } from '../justificatifs';

beforeEach(async () => {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, ventilation_group_id TEXT);
    CREATE TABLE remboursements (id TEXT, group_id TEXT, demandeur TEXT, total_cents INTEGER, amount_cents INTEGER, ecriture_id TEXT);
    CREATE TABLE justificatifs (id TEXT, group_id TEXT, entity_type TEXT, entity_id TEXT, uploaded_at TEXT);
  `);
  await testDb.prepare("INSERT INTO ecritures VALUES ('H','g',30000,'vg1')").run();
  await testDb.prepare("INSERT INTO ecritures VALUES ('C','g',17032,'vg1')").run();
  await testDb.prepare("INSERT INTO remboursements VALUES ('R1','g','Florence',30000,30000,'H')").run();
});

it('expose ventilationGroupTotalCents = Σ du groupe', async () => {
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'H');
  expect(bundle.ventilationGroupTotalCents).toBe(47032);
});

it('sans groupe : ventilationGroupTotalCents = montant propre', async () => {
  await testDb.prepare("INSERT INTO ecritures VALUES ('SOLO','g',9900,NULL)").run();
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'SOLO');
  expect(bundle.ventilationGroupTotalCents).toBe(9900);
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run : `pnpm test justificatifs-bundle-ventilation`
Expected : FAIL — `ventilationGroupTotalCents` est `undefined`.

- [ ] **Step 3 : Implémenter dans `justificatifs.ts`** — ajouter le champ à l'interface (après `viaRemboursement`, ligne ~66) :

```ts
  /** Total du virement pour la couverture : Σ des montants du groupe de
   *  ventilation si l'écriture est ventilée, sinon son propre montant. */
  ventilationGroupTotalCents: number;
```

Dans `listJustificatifsForEcriture`, après le calcul de `direct` (avant le `return`), lire le montant/groupe et retourner le champ :

```ts
  const ecr = await db
    .prepare('SELECT amount_cents, ventilation_group_id FROM ecritures WHERE group_id = ? AND id = ?')
    .get<{ amount_cents: number; ventilation_group_id: string | null }>(groupId, ecritureId);
  let ventilationGroupTotalCents = ecr?.amount_cents ?? 0;
  if (ecr?.ventilation_group_id) {
    const g = await db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS t FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?')
      .get<{ t: number }>(groupId, ecr.ventilation_group_id);
    ventilationGroupTotalCents = g?.t ?? ventilationGroupTotalCents;
  }

  return { direct, viaRemboursement, ventilationGroupTotalCents };
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run : `pnpm test justificatifs-bundle-ventilation`
Expected : PASS.

- [ ] **Step 5 : Brancher la carte sur le total du groupe** — dans `justificatifs-card.tsx`, remplacer le calcul de couverture (ligne ~64-66) pour utiliser le total du groupe comme dénominateur :

```tsx
  const rembsTotals = bundle.viaRemboursement.map((r) => r.totalCents);
  const virementTotal = bundle.ventilationGroupTotalCents || ecritureAmountCents;
  const coverage = rembsTotals.length > 0
    ? computeRembsCoverage(virementTotal, rembsTotals)
    : null;
```

(Le `tolMontant` de matching des justifs directs, ligne ~42, reste sur `ecritureAmountCents` — hors scope.)

- [ ] **Step 6 : Vérifier build + suite complète**

Run : `pnpm test` puis `pnpm build`
Expected : tests PASS ; build sans erreur TypeScript (le champ obligatoire `ventilationGroupTotalCents` est bien fourni partout où `EcritureJustifsBundle` est construit — il n'y a qu'un producteur, `listJustificatifsForEcriture`).

- [ ] **Step 7 : Commit**

```bash
git add web/src/lib/services/justificatifs.ts web/src/components/ecritures/justificatifs-card.tsx web/src/lib/services/__tests__/justificatifs-bundle-ventilation.test.ts
git commit -m "feat(rembs): bandeau de couverture côté écriture calé sur le total du groupe de ventilation"
```

---

## Self-Review

**Spec coverage :**
- Bloc 1 (assouplir `ventilateDraft`) → Task 1. ✓
- Bloc 2 (`syncEcritureVentilationFromRembs` + intégration + retrait COALESCE) → Tasks 2 & 3. ✓ (tous les cas : ≥2, 1+vg repli, 1 sans vg COALESCE, sous-couverture reste, dépassement abandon, non-draft no-op, →0 via reste). ✓
- Bloc 3 (couverture group-aware : service + bundle + carte) → Task 4 (`getEcritureRembsCoverage`) & Task 5 (bundle + carte). ✓
- Bloc 4 (masquer sous-lignes des candidats) → Task 4. ✓
- Limite assumée (imputation manuelle perdue à la re-ventilation) : documentée dans la spec, pas de code (comportement voulu). ✓
- Hors scope respecté (pas de réaffectation rembs, pas d'appariement, pas de MCP, pas de contrainte SQL). ✓

**Placeholder scan :** aucun TODO/TBD ; tout le code des steps est complet.

**Type consistency :** `syncEcritureVentilationFromRembs(groupId, ecritureId): Promise<void>` cohérent Tasks 2/3. `ventilationGroupTotalCents: number` cohérent Task 5 (interface + producteur + consommateur carte). `VentilationInput` (`amount_cents`, `category_id?`, `unite_id?`, `activite_id?`) conforme à `ecritures-create.ts`. `EcritureContext = { groupId }` conforme à l'usage de `ventilateDraft`.

**Note d'ordonnancement :** Task 3 dépend de Task 2 (helper) et Task 1 (sinon `ventilateDraft` refuse les lignes cat/unité nulles). Respecter l'ordre 1 → 2 → 3 → 4 → 5.
