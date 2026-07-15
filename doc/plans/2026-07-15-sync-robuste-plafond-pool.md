# Sync Comptaweb robuste — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre chaque cycle de sync Comptaweb court par construction (jamais de timeout lambda 60 s) en plafonnant le travail détail par cycle, en parallélisant les fetch CW, et en drainant automatiquement le reste côté client.

**Architecture:** `runSyncCycle` calcule le plan de réconciliation en entier (inchangé), mais borne à K=12 le nombre d'écritures dont il lit le détail CW par cycle (`toProcess` priorisé puis tronqué), pré-fetche ces ≤12 détails via un pool de concurrence 4, expose `remaining` (cwId reportés). Le client relance des cycles `force=1` jusqu'à `remaining=0`, avec garde-fou anti-boucle.

**Tech Stack:** Next 16 App Router, TypeScript, libsql/Turso, vitest.

## Global Constraints

- Tests via **`npx vitest run <chemin>` depuis `web/`** (JAMAIS `pnpm vitest`).
- Tests libsql en mémoire : `file::memory:?cache=shared` + schéma créé en `beforeAll` quand `db.transaction()` est utilisé.
- **Aucun DELETE de donnée métier** — uniquement UPDATE d'imputation / INSERT de ventilations, comme l'existant.
- Migration BDD : colonne **nullable**, `ALTER TABLE ADD COLUMN` dans la migration (après `CREATE TABLE IF NOT EXISTS`), **pas** de `NOT NULL DEFAULT`, **pas** d'index. Cf. `web/AGENTS.md` § libsql/Turso.
- **Commits LOCAUX uniquement. Ne JAMAIS push.**
- Constantes : `MAX_DETAIL_FETCHES_PER_CYCLE = 12`, `DETAIL_FETCH_CONCURRENCY = 4`, garde-fou drainage = `2` cycles sans progrès.
- Français pour tout texte user-facing.

---

### Task 1 : Helper pur `mapWithConcurrency`

**Files:**
- Create: `web/src/lib/services/concurrency.ts`
- Test: `web/src/lib/services/__tests__/concurrency.test.ts`

**Interfaces:**
- Produces: `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]>` — exécute `fn` sur chaque item avec au plus `limit` promesses en vol, préserve l'ordre des résultats (résultat[i] correspond à items[i]), n'échoue jamais globalement (chaque entrée = `PromiseSettledResult`).

- [ ] **Step 1 : Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../concurrency';

const deferred = () => {
  let resolve!: (v: number) => void;
  const promise = new Promise<number>((r) => (resolve = r));
  return { promise, resolve };
};

describe('mapWithConcurrency', () => {
  it('ne dépasse jamais la limite de concurrence', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = async (n: number) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    };
    const res = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, fn);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16,
    ]);
  });

  it('préserve l’ordre malgré des durées variables', async () => {
    const fn = async (n: number) => {
      await new Promise((r) => setTimeout(r, (10 - n) * 3));
      return n;
    };
    const res = await mapWithConcurrency([1, 2, 3, 4], 2, fn);
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2, 3, 4]);
  });

  it('isole les rejets (une erreur n’annule pas les autres)', async () => {
    const fn = async (n: number) => {
      if (n === 2) throw new Error('boom');
      return n;
    };
    const res = await mapWithConcurrency([1, 2, 3], 2, fn);
    expect(res[0]).toMatchObject({ status: 'fulfilled', value: 1 });
    expect(res[1].status).toBe('rejected');
    expect(res[2]).toMatchObject({ status: 'fulfilled', value: 3 });
  });

  it('gère la liste vide et limit ≥ longueur', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
    const res = await mapWithConcurrency([1, 2], 10, async (n) => n);
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2 : Run test to verify it fails**

Run : `npx vitest run src/lib/services/__tests__/concurrency.test.ts`
Expected : FAIL (`mapWithConcurrency` non défini).

- [ ] **Step 3 : Write minimal implementation**

```ts
// web/src/lib/services/concurrency.ts

/**
 * Applique `fn` à chaque item avec au plus `limit` exécutions concurrentes.
 * Préserve l'ordre (résultat[i] ↔ items[i]) et n'échoue jamais globalement :
 * chaque entrée est un PromiseSettledResult (fulfilled/rejected). Un rejet
 * isolé n'interrompt pas les autres. Pur (aucune dépendance), testable.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  if (items.length === 0) return results;
  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}
```

- [ ] **Step 4 : Run test to verify it passes**

Run : `npx vitest run src/lib/services/__tests__/concurrency.test.ts`
Expected : PASS (4/4).

- [ ] **Step 5 : Commit**

```bash
git add web/src/lib/services/concurrency.ts web/src/lib/services/__tests__/concurrency.test.ts
git commit -m "feat(sync): helper pur mapWithConcurrency (pool de concurrence)"
```

---

### Task 2 : Migration BDD `sync_runs.remaining` + type

**Files:**
- Modify: `web/src/lib/db/business-schema.ts` (CREATE TABLE `ensureSyncRunsSchema` ~ligne 852 + migration `ensureReconcileSchema` ~ligne 900)
- Modify: `web/src/lib/services/sync-cycle.ts` (interface `SyncRunRow` ~ligne 104)
- Test: `web/src/lib/db/__tests__/sync-runs-remaining-schema.test.ts`

**Interfaces:**
- Produces: colonne `sync_runs.remaining INTEGER` (nullable) ; `SyncRunRow.remaining: number | null`.

- [ ] **Step 1 : Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapDb } from '@/lib/db/wrap'; // helper existant qui enveloppe un client en DbWrapper
import { ensureSyncRunsSchema, ensureReconcileSchema } from '@/lib/db/business-schema';

// NB : si `@/lib/db/wrap` n'existe pas sous ce nom, utiliser le wrapper
// employé par les autres tests de business-schema (chercher un test voisin
// dans src/lib/db/__tests__/). L'objectif : obtenir un DbWrapper sur un
// client libsql `:memory:`.

describe('sync_runs.remaining', () => {
  it('est présente après ensureSyncRunsSchema (BDD vierge)', async () => {
    const db = wrapDb(createClient({ url: ':memory:' }));
    await ensureSyncRunsSchema(db);
    const cols = await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>();
    expect(cols.some((c) => c.name === 'remaining')).toBe(true);
  });

  it('est ajoutée par ensureReconcileSchema sur une table legacy sans la colonne', async () => {
    const db = wrapDb(createClient({ url: ':memory:' }));
    // table legacy SANS remaining
    await db.exec(`CREATE TABLE sync_runs (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, trigger TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
    await ensureReconcileSchema(db);
    const cols = await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>();
    expect(cols.some((c) => c.name === 'remaining')).toBe(true);
  });
});
```

- [ ] **Step 2 : Run test to verify it fails**

Run : `npx vitest run src/lib/db/__tests__/sync-runs-remaining-schema.test.ts`
Expected : FAIL (colonne `remaining` absente). Si l'import `wrapDb` casse, ajuster selon un test voisin AVANT de conclure au fail attendu.

- [ ] **Step 3 : Ajouter la colonne au CREATE TABLE**

Dans `ensureSyncRunsSchema` (business-schema.ts), ajouter la colonne juste après `detail_fetches` :

```sql
      detail_fetches INTEGER NOT NULL DEFAULT 0,
      remaining INTEGER,
      scope TEXT,
```

- [ ] **Step 4 : Ajouter l'ALTER de migration**

Dans `ensureReconcileSchema`, dans le bloc `if (srCols.length > 0) { ... }`, APRÈS la boucle `intCols` et le bloc `scope` (donc juste avant la fermeture du `if`), ajouter :

```ts
    // remaining : reste-à-traiter du dernier cycle (spec 2026-07-15). Nullable
    // volontairement (vieux runs = NULL = inconnu, PAS 0). Pas de backfill.
    if (!srHas('remaining')) {
      await db.exec('ALTER TABLE sync_runs ADD COLUMN remaining INTEGER');
    }
```

- [ ] **Step 5 : Étendre `SyncRunRow` (sync-cycle.ts)**

Ajouter dans l'interface `SyncRunRow`, après `detail_fetches: number;` :

```ts
  remaining: number | null;
```

- [ ] **Step 6 : Run test to verify it passes**

Run : `npx vitest run src/lib/db/__tests__/sync-runs-remaining-schema.test.ts`
Expected : PASS (2/2).

- [ ] **Step 7 : Non-régression schéma**

Run : `npx vitest run src/lib/db/`
Expected : PASS (aucune régression sur les tests de schéma existants).

- [ ] **Step 8 : Commit**

```bash
git add web/src/lib/db/business-schema.ts web/src/lib/services/sync-cycle.ts web/src/lib/db/__tests__/sync-runs-remaining-schema.test.ts
git commit -m "feat(sync): colonne sync_runs.remaining (nullable, migration idempotente)"
```

---

### Task 3 : Plafond K + priorité + `remaining` dans `runSyncCycle`

**Files:**
- Modify: `web/src/lib/services/sync-cycle.ts` (bloc 7a–7d ~ligne 761-828, `SyncCycleResult` ~ligne 86, `empty()` ~ligne 692, UPDATE final ~ligne 883, return ~ligne 908)
- Test: `web/src/lib/services/__tests__/sync-cycle-plafond.test.ts`

**Interfaces:**
- Consumes: `SyncRunRow.remaining` (Task 2).
- Produces: `SyncCycleResult.remaining: number` ; constante `MAX_DETAIL_FETCHES_PER_CYCLE`. La liste des cwId à traiter est **priorisée** (promotions → imports → updates enrichissement → agrégats legacy) puis tronquée à K ; les liaisons de promotion se posent TOUJOURS (seuls les fetch détail sont plafonnés) ; `remaining` = nombre de cwId non fetchés ce cycle.

**Contexte pour l'implémenteur (état actuel du bloc 7) :**
- 7a (`plan.promotions`) : pour chaque promotion, `UPDATE ecritures SET comptaweb_ecriture_id, status='mirror', comptaweb_synced=1` PUIS `toProcess.add(cwId)` + `promoted++`.
- 7b (`plan.updates`) : `if (u.needsDetail) toProcess.add(u.cw.cwId)`.
- 7c (`plan.imports`) : `for (const cw of plan.imports) toProcess.add(cw.cwId)`.
- 7c-bis : détecte des cwId « agrégats legacy » et `toProcess.add(row.cwId)`.
- 7d : `for (const cwId of toProcess) { ... processCwEcriture ... }`.
- `toProcess` est un `Set<number>`.
Convergence (déjà vérifiée) : `needsDetail = cwSignature !== signature || !hasImputation` — une promotion posée mais non enrichie (imputation vide) est re-détectée au cycle suivant en 7b.

- [ ] **Step 1 : Write the failing tests**

Créer `web/src/lib/services/__tests__/sync-cycle-plafond.test.ts`. S'INSPIRER d'un test existant de `runSyncCycle` (chercher `runSyncCycle` dans `src/lib/services/__tests__/` pour le pattern d'injection : `loadConfig`, `scrapeListe`, `scanDrafts`, `scrapeDetail`, `resolve*Id`, `now`, et le setup BDD `file::memory:?cache=shared` + schéma en `beforeAll`). Réutiliser ce harnais. Tests à ajouter :

```ts
// Pseudocode des assertions clés (adapter au harnais existant) :

// A. Plafond : 20 écritures CW à enrichir, K=12 → exactement 12 scrapeDetail,
//    remaining === 8, status 'ok'.
it('plafonne à K scrapeDetail par cycle et renvoie remaining', async () => {
  const scrapeDetail = vi.fn(async (cwId: number) => ventilationsFor(cwId));
  const res = await runSyncCycle(db, groupId, {
    trigger: 'manual', force: true,
    loadConfig, scrapeListe: listeOf(20), scanDrafts: emptyScan,
    scrapeDetail, resolveActiviteId, resolveUniteId, resolveCategoryId,
    now,
  });
  expect(scrapeDetail).toHaveBeenCalledTimes(12);
  expect(res.remaining).toBe(8);
  expect(res.status).toBe('ok');
});

// B. Convergence : deux cycles enchaînés sur 20 → remaining 8 puis 0,
//    total scrapeDetail = 20 (pas 32 : aucune écriture retraitée).
it('draine en deux cycles sans retraiter les écritures déjà enrichies', async () => {
  const scrapeDetail = vi.fn(async (cwId) => ventilationsFor(cwId));
  const opts = { /* mêmes injections, force:true */ };
  const r1 = await runSyncCycle(db, groupId, opts);
  const r2 = await runSyncCycle(db, groupId, opts);
  expect(r1.remaining).toBe(8);
  expect(r2.remaining).toBe(0);
  expect(scrapeDetail).toHaveBeenCalledTimes(20);
});

// C. Priorité : 1 promotion + 1 import + 15 updates, K=2 → les 2 cwId
//    fetchés sont la promotion puis l'import (ordre de priorité).
it('priorise promotions puis imports quand le budget est serré', async () => {
  // fixer MAX via injection (voir Step 3) ou fabriquer exactement 2 de budget.
  // asserter que scrapeDetail a été appelé avec [cwPromo, cwImport].
});

// D. Les opérations sans fetch s'exécutent intégralement même tronqué :
//    avec des deletions/suggestions au plan, leurs compteurs sont inchangés
//    vs un run non plafonné.
it('applique deletions/suggestions en entier malgré la troncature', async () => {
  // plan avec 20 à enrichir + 3 deletions + 2 suggestions, K=12
  // → supprimee_cw_detected reflète les 3, link_suggestions_created les 2.
});

// E. Liaison de promotion hors budget : une promotion au-delà de K a quand
//    même son UPDATE de liaison (status mirror + comptaweb_ecriture_id posés).
it('pose la liaison des promotions même au-delà du budget', async () => {
  // 15 promotions, K=12 → les 15 écritures ont comptaweb_ecriture_id non nul
  // et status='mirror' en BDD, mais scrapeDetail appelé 12 fois, remaining 3.
});
```

- [ ] **Step 2 : Run tests to verify they fail**

Run : `npx vitest run src/lib/services/__tests__/sync-cycle-plafond.test.ts`
Expected : FAIL (`res.remaining` undefined ; plafond non appliqué → 20 appels).

- [ ] **Step 3 : Constante + type + empty()**

Dans sync-cycle.ts, section Constantes (~ligne 138) :

```ts
/** Plafond de lectures détail CW par cycle : borne le temps d'un run bien
 *  sous maxDuration=60s. Le reste est drainé aux cycles suivants (remaining).
 *  Cf. spec 2026-07-15. Overridable pour tests. */
const MAX_DETAIL_FETCHES_PER_CYCLE = 12;
```

Ajouter à `SyncCycleOptions` (pour testabilité du plafond) :

```ts
  /** Injection pour tests : plafond de scrapeDetail par cycle. */
  maxDetailFetches?: number;
```

Ajouter à `SyncCycleResult` (après `detail_fetches: number;`) :

```ts
  remaining: number;
```

Ajouter à `empty()` (après `detail_fetches: 0,`) :

```ts
    remaining: 0,
```

- [ ] **Step 4 : Refactor du bloc 7 — collecte priorisée + troncature**

Remplacer la construction du `Set toProcess` (7a–7c-bis) par une **liste ordonnée par priorité**, en préservant les effets de bord existants (UPDATE liaison des promotions, `promoted++`). Structure cible :

```ts
    // Collecte priorisée des cwId nécessitant une lecture détail. L'ordre
    // reflète la visibilité utilisateur : promotions (deviennent mirror),
    // imports (nouvelles lignes), enrichissements, agrégats legacy. On
    // tronque ensuite à K : le reste (remaining) est drainé au cycle suivant.
    const detailQueue: number[] = [];
    const enqueued = new Set<number>();
    const enqueue = (cwId: number) => {
      if (!enqueued.has(cwId)) {
        enqueued.add(cwId);
        detailQueue.push(cwId);
      }
    };

    // 7a. Promotions : la LIAISON est posée dans tous les cas (draft→cwId
    //     correct). Seul le fetch détail est plafonné → enqueue.
    for (const p of plan.promotions) {
      await db
        .prepare(
          `UPDATE ecritures SET comptaweb_ecriture_id = ?, status = 'mirror', comptaweb_synced = 1, updated_at = ? WHERE id = ?`,
        )
        .run(p.cw.cwId, now, p.ecritureId);
      enqueue(p.cw.cwId);
      promoted++;
    }

    // 7b. Updates à enrichir.
    for (const u of plan.updates) {
      if (u.needsDetail) enqueue(u.cw.cwId);
    }

    // 7c. Imports.
    for (const cw of plan.imports) enqueue(cw.cwId);

    // 7c-bis. Agrégats legacy (bloc inchangé, mais enqueue au lieu de add).
    for (const row of snapshot) {
      if (enqueued.has(row.cwId)) continue;
      const piece = row.numeroPiece.trim();
      const loose = piece
        ? await db.prepare(/* … requête existante … */).get(groupId, piece)
        : await db.prepare(/* … requête existante … */).get(groupId, row.date, row.type, row.intitule);
      if (loose) enqueue(row.cwId);
    }

    // Troncature au budget : les K premiers sont traités ce cycle, le reste
    // devient `remaining` (drainé au prochain cycle, idempotent).
    const budget = opts.maxDetailFetches ?? MAX_DETAIL_FETCHES_PER_CYCLE;
    const toProcess = detailQueue.slice(0, budget);
    const remaining = detailQueue.length - toProcess.length;
```

**Attention priorité 7c-bis :** l'ordre `promotions → updates → imports` ci-dessus place les imports APRÈS les updates, alors que la spec dit `promotions → imports → updates`. Corriger l'ordre d'enqueue pour respecter la spec : promotions (7a), puis imports (7c AVANT 7b), puis updates (7b), puis agrégats legacy. Réordonner les blocs d'enqueue en conséquence (les UPDATE de promotion restent en premier ; seul l'ordre des `enqueue` d'imports vs updates change). Le test C valide cet ordre.

- [ ] **Step 5 : 7d — boucle inchangée sur la liste tronquée**

La boucle 7d itère désormais sur `toProcess` (liste, plus Set) — le code interne (`processCwEcriture`, compteurs) est inchangé :

```ts
    for (const cwId of toProcess) {
      const row = snapByCwId.get(cwId);
      if (!row) continue;
      const counts = await processCwEcriture(db, groupId, metaFromSnapshot(row), resolvers, now);
      detailFetches += counts.detailFetched;
      updatedMirror += counts.updated;
      imported += counts.created;
      supprimeeCw += counts.orphaned;
    }
```

- [ ] **Step 6 : Persister `remaining` (UPDATE sync_runs + return)**

Dans l'`UPDATE sync_runs SET ...` final (~ligne 883), ajouter `remaining = ?` (par ex. après `detail_fetches = ?`) et le paramètre correspondant (`remaining`) dans le `.run(...)`.

Dans le `return { ... }` (~ligne 908), ajouter `remaining,` (après `detail_fetches: detailFetches,`).

- [ ] **Step 7 : Run tests to verify they pass**

Run : `npx vitest run src/lib/services/__tests__/sync-cycle-plafond.test.ts`
Expected : PASS (A–E).

- [ ] **Step 8 : Non-régression sync**

Run : `npx vitest run src/lib/services/`
Expected : PASS. Les tests `runSyncCycle` existants doivent rester verts (petits jeux < 12 → remaining 0, comportement identique). Corriger tout test qui asserte la forme exacte de `SyncCycleResult` en ajoutant `remaining`.

- [ ] **Step 9 : Commit**

```bash
git add web/src/lib/services/sync-cycle.ts web/src/lib/services/__tests__/sync-cycle-plafond.test.ts
git commit -m "feat(sync): plafond K détails/cycle + priorité + remaining (anti-timeout)"
```

---

### Task 4 : Pool parallèle de fetch détail (concurrence 4)

**Files:**
- Modify: `web/src/lib/services/sync-cycle.ts` (bloc 7d + Constantes ; `resolveVentilations` inchangée)
- Test: `web/src/lib/services/__tests__/sync-cycle-pool.test.ts`

**Interfaces:**
- Consumes: `mapWithConcurrency` (Task 1) ; `toProcess`/`remaining` (Task 3).
- Produces: constante `DETAIL_FETCH_CONCURRENCY = 4`. Les ≤K `scrapeDetail` sont exécutés en pool de 4 en **phase 1** ; la boucle d'application (**phase 2**, writes BDD) reste séquentielle et lit les détails depuis un cache. `detail_fetches` = nombre de scrape réseau réellement tentés (phase 1).

- [ ] **Step 1 : Write the failing test**

```ts
// Pseudocode (adapter au harnais runSyncCycle) :

// A. Concurrence : avec 12 écritures et un scrapeDetail instrumenté qui
//    mesure le pic de concurrence, le pic ≤ 4.
it('exécute les scrapeDetail avec au plus 4 en vol', async () => {
  let inFlight = 0, peak = 0;
  const scrapeDetail = vi.fn(async (cwId: number) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await tick();
    inFlight--;
    return ventilationsFor(cwId);
  });
  await runSyncCycle(db, groupId, { /* 12 à enrichir, force:true, injections */ scrapeDetail });
  expect(peak).toBeLessThanOrEqual(4);
  expect(scrapeDetail).toHaveBeenCalledTimes(12);
});

// B. Un fetch en échec n'empêche pas l'application des autres.
it('applique les autres écritures malgré un fetch en échec', async () => {
  const scrapeDetail = vi.fn(async (cwId: number) => {
    if (cwId === FAILING_CW) throw new Error('CW 500');
    return ventilationsFor(cwId);
  });
  const res = await runSyncCycle(db, groupId, { /* 5 à enrichir dont FAILING */ scrapeDetail });
  expect(res.status).toBe('ok');
  // les 4 autres écritures sont bien créées/mises à jour (imported/updated_mirror > 0)
});
```

- [ ] **Step 2 : Run test to verify it fails**

Run : `npx vitest run src/lib/services/__tests__/sync-cycle-pool.test.ts`
Expected : FAIL (test A : pic de concurrence = 1, exécution séquentielle actuelle).

- [ ] **Step 3 : Constante + import**

En tête de fichier, ajouter l'import :

```ts
import { mapWithConcurrency } from './concurrency';
```

Section Constantes :

```ts
/** Concurrence des lectures détail CW (le coût dominant est le HTTP CW ;
 *  les writes BDD restent séquentiels). Cf. spec 2026-07-15. */
const DETAIL_FETCH_CONCURRENCY = 4;
```

- [ ] **Step 4 : Phase 1 (pré-fetch parallèle) + phase 2 (application séquentielle)**

Remplacer la boucle 7d (Task 3, Step 5) par :

```ts
    // Phase 1 — pré-fetch des détails en parallèle (pool borné). Le HTTP CW
    // est le coût dominant ; on le parallélise, mais PAS les writes BDD.
    // Cache : cwId → détail OK ; les échecs sont marqués et re-throwés en
    // phase 2 (→ resolveVentilations les catch → écriture laissée intacte).
    const detailCache = new Map<number, EcritureDetail>();
    const detailFailed = new Set<number>();
    const settled = await mapWithConcurrency(
      toProcess,
      DETAIL_FETCH_CONCURRENCY,
      (cwId) => resolvers.scrapeDetail(cwId),
    );
    settled.forEach((r, i) => {
      const cwId = toProcess[i];
      if (r.status === 'fulfilled') detailCache.set(cwId, r.value);
      else {
        detailFailed.add(cwId);
        logError('sync-cycle', 'scrapeEcritureDetail failed (pool)', r.reason, { cwId });
      }
    });
    detailFetches = toProcess.length; // fetch réseau tentés ce cycle

    // Resolvers de phase 2 : scrapeDetail lit le cache (aucun réseau ; un
    // échec de phase 1 est re-throwé pour être neutralisé proprement).
    const cachedResolvers: Resolvers = {
      ...resolvers,
      scrapeDetail: async (cwId: number) => {
        if (detailFailed.has(cwId)) throw new Error('detail fetch failed (pool)');
        const d = detailCache.get(cwId);
        if (d) return d;
        return resolvers.scrapeDetail(cwId); // filet (ne devrait pas arriver)
      },
    };

    // Phase 2 — application séquentielle (writes BDD non concurrents).
    for (const cwId of toProcess) {
      const row = snapByCwId.get(cwId);
      if (!row) continue;
      const counts = await processCwEcriture(db, groupId, metaFromSnapshot(row), cachedResolvers, now);
      // detailFetched compté en phase 1 : ne pas ré-additionner counts.detailFetched.
      updatedMirror += counts.updated;
      imported += counts.created;
      supprimeeCw += counts.orphaned;
    }
```

Note : `detailFetches` était incrémenté via `counts.detailFetched` en Task 3 ; ici il est fixé en phase 1. Supprimer l'ancienne ligne `detailFetches += counts.detailFetched;` (remplacée). Garder l'initialisation `let detailFetches = 0;` existante.

- [ ] **Step 5 : Run test to verify it passes**

Run : `npx vitest run src/lib/services/__tests__/sync-cycle-pool.test.ts`
Expected : PASS (A, B).

- [ ] **Step 6 : Non-régression sync (plafond + pool ensemble)**

Run : `npx vitest run src/lib/services/`
Expected : PASS (dont `sync-cycle-plafond.test.ts` : le comptage `scrapeDetail` et `remaining` restent identiques ; seul l'ordonnancement fetch change, pas les compteurs).

- [ ] **Step 7 : Commit**

```bash
git add web/src/lib/services/sync-cycle.ts web/src/lib/services/__tests__/sync-cycle-pool.test.ts
git commit -m "feat(sync): pool parallèle (4) de fetch détail, writes séquentiels"
```

---

### Task 5 : Auto-drainage côté client

**Files:**
- Create: `web/src/components/sync/drain-decision.ts` (fonction pure)
- Test: `web/src/components/sync/__tests__/drain-decision.test.ts`
- Modify: `web/src/components/sync/use-sync-status.ts` (types `SyncRunRow`/`SyncStatusPayload`, `runSync`)
- Modify: `web/src/components/sync/sync-status-button.tsx` (libellé « (N restantes) »)

**Interfaces:**
- Consumes: `SyncCycleResult.remaining` (renvoyé dans le corps du POST `/api/sync/run`, Task 3).
- Produces: `shouldDrainAgain(prev: number | null, next: number, noProgress: number): { drain: boolean; noProgress: number }` — décide si relancer un cycle et met à jour le compteur de cycles sans progrès.

- [ ] **Step 1 : Write the failing test (fonction pure)**

```ts
import { describe, it, expect } from 'vitest';
import { shouldDrainAgain, MAX_NO_PROGRESS } from '../drain-decision';

describe('shouldDrainAgain', () => {
  it('draine tant que remaining décroît', () => {
    expect(shouldDrainAgain(null, 8, 0)).toEqual({ drain: true, noProgress: 0 });
    expect(shouldDrainAgain(8, 3, 0)).toEqual({ drain: true, noProgress: 0 });
  });

  it('s’arrête quand remaining atteint 0', () => {
    expect(shouldDrainAgain(3, 0, 0)).toEqual({ drain: false, noProgress: 0 });
  });

  it('compte les cycles sans progrès et stoppe au seuil', () => {
    // remaining stagne à 5 : 1er sans progrès → continue, 2e → stop
    const a = shouldDrainAgain(5, 5, 0);
    expect(a).toEqual({ drain: true, noProgress: 1 });
    const b = shouldDrainAgain(5, 5, a.noProgress);
    expect(b).toEqual({ drain: false, noProgress: 2 });
    expect(MAX_NO_PROGRESS).toBe(2);
  });

  it('remet le compteur à zéro dès qu’un progrès reprend', () => {
    expect(shouldDrainAgain(5, 4, 1)).toEqual({ drain: true, noProgress: 0 });
  });
});
```

- [ ] **Step 2 : Run test to verify it fails**

Run : `npx vitest run src/components/sync/__tests__/drain-decision.test.ts`
Expected : FAIL (module absent).

- [ ] **Step 3 : Implémenter la fonction pure**

```ts
// web/src/components/sync/drain-decision.ts

/** Nombre de cycles consécutifs SANS progrès (remaining non décroissant)
 *  avant d'abandonner le drainage (garde-fou anti-boucle contre un CW KO). */
export const MAX_NO_PROGRESS = 2;

/**
 * Décide si relancer un cycle de sync pour drainer le reste.
 * `prev` = remaining du cycle précédent (null au 1er) ; `next` = remaining
 * du cycle qui vient de finir ; `noProgress` = compteur courant de cycles
 * sans progrès. Retourne la décision + le compteur mis à jour.
 */
export function shouldDrainAgain(
  prev: number | null,
  next: number,
  noProgress: number,
): { drain: boolean; noProgress: number } {
  if (next <= 0) return { drain: false, noProgress: 0 };
  const progressed = prev == null || next < prev;
  if (progressed) return { drain: true, noProgress: 0 };
  const nextNoProgress = noProgress + 1;
  if (nextNoProgress >= MAX_NO_PROGRESS) return { drain: false, noProgress: nextNoProgress };
  return { drain: true, noProgress: nextNoProgress };
}
```

- [ ] **Step 4 : Run test to verify it passes**

Run : `npx vitest run src/components/sync/__tests__/drain-decision.test.ts`
Expected : PASS (4/4).

- [ ] **Step 5 : Étendre les types client (use-sync-status.ts)**

Ajouter `remaining: number | null;` à `SyncRunRow` (après `duration_ms`). Aucune autre modif de type nécessaire (le POST renvoie le `SyncCycleResult` complet).

- [ ] **Step 6 : Câbler le drainage dans `runSync`**

Modifier `runSync` pour lire `remaining` dans la réponse du POST et re-boucler via `shouldDrainAgain`. Remplacer le corps qui suit `if (!res.ok)` par une lecture du JSON et une boucle de drainage. Le hook expose un nouvel état `remaining` (via `useState<number>(0)`), affiché par le bouton. Structure cible (adapter aux noms/états existants) :

```ts
import { shouldDrainAgain } from './drain-decision';
// … dans le composant : const [remaining, setRemaining] = useState(0);

const runSync = useCallback(
  async (force: boolean) => {
    setState('running');
    let prev: number | null = null;
    let noProgress = 0;
    // Boucle de drainage : enchaîne des cycles tant qu'il reste du travail.
    // 1er appel avec `force` reçu ; les relances de drainage forcent (bypass
    // throttle 15 min, le verrou already_running protège la concurrence).
    for (let guard = 0; guard < 50; guard++) {
      const url = guard === 0 && !force ? '/api/sync/run' : '/api/sync/run?force=1';
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST' });
      } catch {
        setState('error');
        return;
      }
      if (res.status === 429) {
        await fetchStatus();
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      const result = (await res.json().catch(() => null)) as { remaining?: number } | null;
      const next = result?.remaining ?? 0;
      setRemaining(next);
      const decision = shouldDrainAgain(prev, next, noProgress);
      prev = next;
      noProgress = decision.noProgress;
      if (!decision.drain) break;
    }
    setRemaining(0);
    await fetchStatus();
    router.refresh();
  },
  [fetchStatus, router],
);
```

Notes :
- Le garde `guard < 50` est une butée dure de sécurité (jamais atteinte en pratique : `shouldDrainAgain` stoppe bien avant). Documenter par un commentaire.
- Le polling `setInterval` de l'ancien `runSync` n'est plus nécessaire dans ce chemin (le POST est synchrone et on boucle jusqu'à épuisement) ; conserver `clearPoll()` au début pour annuler un polling de mount en cours. Le chemin « is_running au mount » (useEffect) reste inchangé.
- Exposer `remaining` dans le `return { status, state, runSync, remaining }` du hook.

- [ ] **Step 7 : Libellé « (N restantes) » (sync-status-button.tsx)**

Récupérer `remaining` depuis `useSyncStatus()`. Dans le calcul du `label`, brancher :

```tsx
  if (state === 'running') {
    label = remaining > 0 ? `Synchronisation… (${remaining} restantes)` : 'Synchronisation…';
    Icon = RefreshCw;
    extraClasses = 'text-brand';
  }
```

- [ ] **Step 8 : Run tests + typecheck + build**

Run : `npx vitest run src/components/sync/`
Expected : PASS.
Run : `npx tsc --noEmit`
Expected : 0 erreur.
Run : `npx next build`
Expected : build OK.

- [ ] **Step 9 : Commit**

```bash
git add web/src/components/sync/
git commit -m "feat(sync): auto-drainage client jusqu'à remaining=0 (garde-fou anti-boucle)"
```

---

## Self-Review (à faire par le contrôleur après le plan)

- **Spec coverage :** A (plafond) = Task 3 ; B (pool) = Task 1 + Task 4 ; auto-drainage = Task 5 ; migration = Task 2. ✅
- **Type consistency :** `remaining` — `SyncCycleResult.remaining: number` (T3), `SyncRunRow.remaining: number | null` (T2 serveur + T5 client), colonne SQL nullable (T2). Cohérent.
- **Convergence :** vérifiée via `needsDetail = signature≠ || !hasImputation` (promotion non enrichie re-détectée). Test B (Task 3) la verrouille.
- **Ordre des tâches :** T1 (helper) et T2 (migration) indépendantes ; T3 dépend de T2 (type) ; T4 dépend de T1 + T3 ; T5 dépend de T3 (remaining dans la réponse). Exécuter dans l'ordre 1→5.
