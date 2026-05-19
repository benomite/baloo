# Phase 2 — Sync incrémental Comptaweb

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire la sync incrémentale qui promeut `ecritures.status='pending_sync'` → `mirror` par matching `cw_numero_piece`, maintient les drafts pour les lignes bancaires orphelines, et expose un bouton header client-piloté pour forcer le sync. Audit complet via une nouvelle table `sync_runs`.

**Architecture:**
- Service orchestrateur `runSyncCycle(groupId, opts)` : scrape liste CW complète + rapprochement, promote pending_sync → mirror, upsert drafts orphelins, detect divergent, trace audit.
- Throttle 15 min + verrou running < 60 s, par `group_id`. Multi-tenant strict.
- Endpoints `POST /api/sync/run` + `GET /api/sync/status`.
- Tool MCP `sync_run` + helper `ensureSyncFresh()` appelé en début de tools comptables sensibles.
- Composant client `<SyncStatusButton>` dans header, pattern uniforme (pas de `after()`, pas de cron).

**Tech Stack:** Next.js 16 (App Router), Turso/libsql, Vitest, TypeScript, scraping Comptaweb (existant + ajout), Auth.js (existant), Streamable HTTP MCP (existant).

**Spec de référence :** [doc/specs/2026-05-19-baloo-sync-incremental-design.md](../specs/2026-05-19-baloo-sync-incremental-design.md)

---

## Task 1 : Migration BDD `sync_runs`

**Files:**
- Modify: `web/src/lib/db/business-schema.ts` (ajout CREATE TABLE + INDEX dans `ensureBusinessSchema`)
- Create: `web/src/lib/db/__tests__/sync-runs-schema.test.ts`

- [ ] **Step 1: Définir le DDL de `sync_runs`**

Schéma (cf. spec section "Schéma BDD") :

```sql
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  promoted_to_mirror INTEGER NOT NULL DEFAULT 0,
  new_drafts INTEGER NOT NULL DEFAULT 0,
  updated_drafts INTEGER NOT NULL DEFAULT 0,
  divergent_detected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_group_started
  ON sync_runs(group_id, started_at DESC);
```

**Important** (cf. AGENTS.md) :
- Pas de CHECK SQL sur `status` ni `trigger`. Validation côté code via enum TS.
- Le CREATE TABLE va dans `business-schema.ts` (BDD vierge). Aucune migration `ALTER` à prévoir, table neuve.

- [ ] **Step 2: Ajouter dans `ensureBusinessSchema`**

Localiser la fonction `ensureBusinessSchema` et ajouter le bloc table+index avec un commentaire pointant la spec.

- [ ] **Step 3: Test schéma**

```ts
// web/src/lib/db/__tests__/sync-runs-schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb } from '@/lib/db/test-helpers';
import { ensureBusinessSchema } from '@/lib/db/business-schema';

describe('sync_runs schema', () => {
  it('crée la table et l\'index', async () => {
    const db = getTestDb();
    await ensureBusinessSchema(db);
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_runs'"
    ).all();
    expect(tables).toHaveLength(1);
    const idx = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sync_runs_group_started'"
    ).all();
    expect(idx).toHaveLength(1);
  });

  it('idempotent : second appel ne casse pas', async () => {
    const db = getTestDb();
    await ensureBusinessSchema(db);
    await ensureBusinessSchema(db);
    // pas d'exception levée
  });
});
```

Run: `pnpm vitest run sync-runs-schema`

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/db/business-schema.ts web/src/lib/db/__tests__/sync-runs-schema.test.ts
git commit -m "feat(db): table sync_runs pour audit sync incrémental (Phase 2)"
```

---

## Task 2 : `scrapeListeEcritures(exercice)` — liste complète CW

**Files:**
- Create: `web/src/lib/comptaweb/ecritures-list-scrape.ts`
- Create: `web/src/lib/comptaweb/__tests__/ecritures-list-scrape.test.ts`
- Modify: `web/src/lib/comptaweb/index.ts` (re-export)
- Reference: fixtures HTML dans `web/src/lib/comptaweb/__tests__/fixtures/` (à enrichir)

- [ ] **Step 1: Capture d'une page CW liste écritures**

Sur l'environnement local de l'auteur (qui a déjà session CW), naviguer manuellement vers la page liste écritures de l'exercice courant et copier le HTML dans `web/src/lib/comptaweb/__tests__/fixtures/ecritures-list-exercice-2026.html`.

**Note** : ne pas commiter de données sensibles (numéros de pièce réels OK, mais vérifier qu'aucun nom de personne mineur n'apparaît dans les libellés — sinon anonymiser).

- [ ] **Step 2: Définir le type retour**

```ts
// web/src/lib/comptaweb/types.ts (ajout)
export interface CwEcritureRow {
  id: string;                 // id interne CW (data-id du tr)
  numero_piece: string;       // ex: "DEP-12", "REC-3"
  date_ecriture: string;      // ISO YYYY-MM-DD
  type: 'depense' | 'recette';
  intitule: string;
  montant_centimes: number;   // toujours positif (type donne le signe)
  nature_libelle: string;     // string brut du tableau
  mode_paiement_libelle?: string;
  activite_libelle?: string;
  branche_libelle?: string;
  rapproche: boolean;         // colonne "Rapproché" du tableau
}

export interface ScrapeListeEcrituresResult {
  exercice_id: string;
  exercice_libelle: string;
  ecritures: CwEcritureRow[];
}
```

- [ ] **Step 3: Implémenter le scraper**

```ts
// web/src/lib/comptaweb/ecritures-list-scrape.ts
import { load } from 'cheerio';
import { getOrCreateSession, type ComptawebConfig } from './auth';
import { httpGet } from './http';
import { parseMontantCentimes } from './utils';

export async function scrapeListeEcritures(
  config: ComptawebConfig,
  exerciceId?: string,  // si undefined, exercice courant
): Promise<ScrapeListeEcrituresResult> {
  // 1. GET page liste écritures (URL à confirmer depuis comptaweb-api-endpoints.md)
  // 2. Si pagination → boucle until last page
  // 3. Pour chaque <tr>, extraire les colonnes
  // 4. Retourner { exercice_id, exercice_libelle, ecritures: [...] }
}
```

L'URL exacte et la structure HTML : se référer à `doc/comptaweb-api-endpoints.md` + reverse-engineering via fixtures.

- [ ] **Step 4: Tests sur fixtures**

```ts
describe('scrapeListeEcritures', () => {
  it('parse l\'exercice 2026 avec N écritures', async () => {
    const html = await readFixture('ecritures-list-exercice-2026.html');
    const result = parseListeEcritures(html);
    expect(result.exercice_libelle).toBe('2026');
    expect(result.ecritures.length).toBeGreaterThan(0);
    expect(result.ecritures[0]).toMatchObject({
      numero_piece: expect.any(String),
      date_ecriture: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      type: expect.stringMatching(/^(depense|recette)$/),
      montant_centimes: expect.any(Number),
    });
  });

  it('gère la pagination', async () => {
    // Fixture multi-pages OR mock httpGet
  });

  it('détecte numero_piece "DEP-12" et "REC-3"', async () => { /* ... */ });
  it('parse les montants format français (1 234,56 €)', async () => { /* ... */ });
  it('détecte rapproché = true/false par classe CSS', async () => { /* ... */ });
});
```

- [ ] **Step 5: Re-export**

```ts
// web/src/lib/comptaweb/index.ts
export { scrapeListeEcritures } from './ecritures-list-scrape';
export type { CwEcritureRow, ScrapeListeEcrituresResult } from './types';
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/comptaweb/ecritures-list-scrape.ts \
        web/src/lib/comptaweb/__tests__/ecritures-list-scrape.test.ts \
        web/src/lib/comptaweb/__tests__/fixtures/ecritures-list-*.html \
        web/src/lib/comptaweb/index.ts \
        web/src/lib/comptaweb/types.ts
git commit -m "feat(comptaweb): scrapeListeEcritures(exercice) + fixtures (Phase 2)"
```

---

## Task 3 : Service `runSyncCycle` (orchestrateur)

**Files:**
- Create: `web/src/lib/services/sync-cycle.ts`
- Create: `web/src/lib/services/__tests__/sync-cycle.test.ts`
- Modify: `web/src/lib/services/drafts.ts` (`scanDraftsFromComptaweb` retourne maintenant `{ new, updated }`)

- [ ] **Step 1: Définir l'API du service**

```ts
// web/src/lib/services/sync-cycle.ts
export interface SyncCycleOptions {
  trigger: 'client' | 'mcp' | 'manual';
  force?: boolean;
}

export interface SyncCycleResult {
  sync_run_id: string;
  status: 'ok' | 'failed' | 'skipped';
  promoted_to_mirror: number;
  new_drafts: number;
  updated_drafts: number;
  divergent_detected: number;
  duration_ms: number;
  error_message?: string;
  skipped_reason?: 'throttled' | 'already_running';
}

export async function runSyncCycle(
  groupId: string,
  opts: SyncCycleOptions,
): Promise<SyncCycleResult>;

// Helper exposé pour tools MCP
export async function ensureSyncFresh(
  groupId: string,
  trigger: 'mcp' | 'manual',
): Promise<void>;  // await la sync si stale, sinon retourne immédiat

// Pour endpoint GET /status
export interface SyncStatus {
  group_id: string;
  last_run: SyncRunRow | null;
  is_running: boolean;
  stale: boolean;
  throttle_until: string | null;
}

export async function getSyncStatus(groupId: string): Promise<SyncStatus>;
```

- [ ] **Step 2: Implémentation du throttle + verrou**

```ts
async function shouldSkip(db, groupId, force): Promise<{skip: boolean, reason?: string}> {
  // 1. running < 60s ? → skip 'already_running'
  // 2. !force && last_ok < 15 min ? → skip 'throttled'
  // 3. sinon : run
}
```

- [ ] **Step 3: Implémentation du cycle**

```ts
export async function runSyncCycle(groupId, opts) {
  const db = getDb();
  const startedAt = currentTimestamp();
  const start = Date.now();

  const skip = await shouldSkip(db, groupId, opts.force);
  if (skip.skip) return { status: 'skipped', skipped_reason: skip.reason, ... };

  const syncRunId = await nextId('SYNC');
  await db.prepare(
    `INSERT INTO sync_runs (id, group_id, started_at, status, trigger, created_at)
     VALUES (?, ?, ?, 'running', ?, ?)`
  ).run(syncRunId, groupId, startedAt, opts.trigger, startedAt);

  try {
    const config = await loadComptawebConfig(groupId);

    // Parallélise les 2 scrapes
    const [listeResult, rappResult] = await Promise.all([
      scrapeListeEcritures(config),
      listRapprochementBancaire(config),
    ]);

    const promoted = await promotePendingSyncToMirror(db, groupId, listeResult.ecritures);
    const drafts = await scanDraftsFromComptaweb(db, groupId, rappResult);
    const divergent = await detectDivergent(db, groupId, listeResult.ecritures);

    const finishedAt = currentTimestamp();
    const durationMs = Date.now() - start;

    await db.prepare(
      `UPDATE sync_runs SET finished_at = ?, status = 'ok',
       promoted_to_mirror = ?, new_drafts = ?, updated_drafts = ?,
       divergent_detected = ?, duration_ms = ?
       WHERE id = ?`
    ).run(finishedAt, promoted, drafts.new, drafts.updated, divergent, durationMs, syncRunId);

    return { sync_run_id: syncRunId, status: 'ok', promoted_to_mirror: promoted, ... };
  } catch (err) {
    await db.prepare(
      `UPDATE sync_runs SET finished_at = ?, status = 'failed',
       error_message = ?, duration_ms = ? WHERE id = ?`
    ).run(currentTimestamp(), String(err), Date.now() - start, syncRunId);

    logError('sync-cycle', 'runSyncCycle failed', err, { groupId, syncRunId });
    return { sync_run_id: syncRunId, status: 'failed', error_message: String(err), ... };
  }
}
```

- [ ] **Step 4: `promotePendingSyncToMirror`**

Sous-fonction interne :

```ts
async function promotePendingSyncToMirror(db, groupId, cwEcritures): Promise<number> {
  const pendingSyncs = await db.prepare(
    `SELECT id, cw_numero_piece, amount_cents, date_ecriture, type
     FROM ecritures
     WHERE group_id = ? AND status = 'pending_sync' AND cw_numero_piece IS NOT NULL`
  ).all(groupId);

  let count = 0;
  for (const baloo of pendingSyncs) {
    const cw = cwEcritures.find(c => c.numero_piece === baloo.cw_numero_piece);
    if (!cw) continue;
    if (cw.montant_centimes !== baloo.amount_cents || cw.type !== baloo.type) {
      // divergent : géré par detectDivergent dans le même cycle
      continue;
    }
    await db.prepare(
      `UPDATE ecritures SET status = 'mirror', updated_at = ? WHERE id = ?`
    ).run(currentTimestamp(), baloo.id);
    count++;
  }
  return count;
}
```

- [ ] **Step 5: `detectDivergent`**

```ts
async function detectDivergent(db, groupId, cwEcritures): Promise<number> {
  // Compare les écritures 'mirror' Baloo avec leur miroir CW.
  // Si montant/date/type diffèrent → UPDATE status='divergent' + count.
  // NB: PR Phase 2 minimal : on log + count, l'arbitrage est Phase 4.
}
```

- [ ] **Step 6: Refacto `scanDraftsFromComptaweb`**

Modifier le retour pour inclure `{ new, updated }` au lieu de juste le nombre total.

- [ ] **Step 7: `ensureSyncFresh`**

```ts
export async function ensureSyncFresh(groupId, trigger) {
  const status = await getSyncStatus(groupId);
  if (status.stale && !status.is_running) {
    await runSyncCycle(groupId, { trigger });
  }
  // sinon : on laisse le sync existant tourner / les data sont fraîches
}
```

- [ ] **Step 8: `getSyncStatus`**

```ts
export async function getSyncStatus(groupId): Promise<SyncStatus> {
  const lastRun = await db.prepare(
    `SELECT * FROM sync_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT 1`
  ).get(groupId);

  const now = Date.now();
  const isRunning = lastRun?.status === 'running' &&
    (now - Date.parse(lastRun.started_at)) < 60_000;
  const lastOk = lastRun?.status === 'ok' ? Date.parse(lastRun.finished_at!) : 0;
  const stale = !lastOk || (now - lastOk) > 15 * 60_000;
  const throttleUntil = lastOk ? new Date(lastOk + 15 * 60_000).toISOString() : null;

  return { group_id: groupId, last_run: lastRun, is_running: isRunning, stale, throttle_until: throttleUntil };
}
```

- [ ] **Step 9: Tests scénarios**

```ts
describe('runSyncCycle', () => {
  // Setup : insert ecritures pending_sync + mocks scrapers

  it('promeut pending_sync → mirror par match cw_numero_piece', async () => {
    // 2 pending_sync, scraper retourne match exact → 2 mirror
  });

  it('détecte divergent quand montant Baloo ≠ CW', async () => {
    // 1 pending_sync, scraper retourne match avec montant différent → 1 divergent
  });

  it('respecte le throttle 15 min', async () => {
    // last_run ok il y a 10 min → status 'skipped' / 'throttled'
  });

  it('throttle bypass par force=true', async () => {
    // last_run ok il y a 10 min + force → status 'ok'
  });

  it('verrou running < 60s → skipped/already_running', async () => {
    // insert sync_runs running il y a 30s → skipped
  });

  it('verrou expire après 60s → run', async () => {
    // insert sync_runs running il y a 70s → run quand même
  });

  it('échec scraper → status failed + error_message', async () => {
    // mock scraper throws → sync_runs failed
  });

  it('drafts orphelins créés + comptés', async () => {
    // mock rapprochement avec 1 ligne bancaire orpheline → new_drafts=1
  });

  it('isolation multi-groupes : sync groupe A n\'affecte pas groupe B', async () => {
    // 2 groupes, sync A → B pas modifié
  });
});

describe('ensureSyncFresh', () => {
  it('await runSyncCycle si stale', async () => { /* ... */ });
  it('skip si fresh < 15 min', async () => { /* ... */ });
});

describe('getSyncStatus', () => {
  it('retourne stale=true si pas de run', async () => { /* ... */ });
  it('retourne is_running=true pendant un run', async () => { /* ... */ });
  it('isolation par group_id', async () => { /* ... */ });
});
```

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/services/sync-cycle.ts \
        web/src/lib/services/__tests__/sync-cycle.test.ts \
        web/src/lib/services/drafts.ts
git commit -m "feat(sync): runSyncCycle orchestrateur + ensureSyncFresh + getSyncStatus"
```

---

## Task 4 : Endpoints API `/api/sync/run` et `/api/sync/status`

**Files:**
- Create: `web/src/app/api/sync/run/route.ts`
- Create: `web/src/app/api/sync/status/route.ts`
- Create: `web/src/app/api/sync/__tests__/run.test.ts`
- Create: `web/src/app/api/sync/__tests__/status.test.ts`

- [ ] **Step 1: `POST /api/sync/run`**

```ts
// web/src/app/api/sync/run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/context';
import { requireAdminRole } from '@/lib/auth/access';
import { runSyncCycle } from '@/lib/services/sync-cycle';

export async function POST(req: NextRequest) {
  const ctx = await getCurrentContext();
  await requireAdminRole(ctx);

  const force = req.nextUrl.searchParams.get('force') === '1';

  const result = await runSyncCycle(ctx.groupId, {
    trigger: 'client',
    force,
  });

  if (result.status === 'skipped') {
    return NextResponse.json(result, { status: 429 });
  }
  if (result.status === 'failed') {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result, { status: 202 });
}
```

- [ ] **Step 2: `GET /api/sync/status`**

```ts
// web/src/app/api/sync/status/route.ts
export async function GET() {
  const ctx = await getCurrentContext();
  await requireAdminRole(ctx);
  const status = await getSyncStatus(ctx.groupId);
  return NextResponse.json(status);
}
```

- [ ] **Step 3: Tests intégration**

- `POST /run` sans auth → 401
- `POST /run` rôle equipier → 403
- `POST /run` rôle tresorier → 202 + sync_run_id
- `POST /run?force=1` après run récent → 202 (override)
- `POST /run` sans force après run récent → 429 + reason throttled
- `POST /run` pendant un run en cours → 429 + reason already_running
- `GET /status` retourne le bon shape

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/sync/
git commit -m "feat(api): POST /api/sync/run + GET /api/sync/status"
```

---

## Task 5 : Tool MCP `sync_run` + `ensureSyncFresh` dans tools sensibles

**Files:**
- Modify: `web/src/lib/mcp/tools/ecritures.ts` (wrapper `ensureSyncFresh` sur `list_ecritures`)
- Modify: `web/src/lib/mcp/tools/vue-ensemble.ts` (wrapper sur `vue_ensemble`)
- Modify: `web/src/lib/mcp/tools/comptaweb-client.ts` (wrapper sur `cw_list_rapprochement_bancaire`)
- Create: `web/src/lib/mcp/tools/sync.ts`
- Modify: `web/src/lib/mcp/register-all.ts` (register `sync_run`)
- Create: `web/src/lib/mcp/tools/__tests__/sync.test.ts`

- [ ] **Step 1: Tool `sync_run`**

```ts
// web/src/lib/mcp/tools/sync.ts
import { z } from 'zod';
import { runSyncCycle } from '@/lib/services/sync-cycle';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

export function registerSyncTools(server: McpServer, ctx: McpToolContext) {
  server.tool(
    'sync_run',
    'Lance un cycle de sync Comptaweb pour le groupe courant. Respecte le throttle 15 min sauf si force=true. Retourne les counts et le status du run.',
    {
      force: z.boolean().optional().describe('Override du throttle 15 min'),
    },
    async ({ force }) => {
      const result = await runSyncCycle(ctx.groupId, { trigger: 'mcp', force });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
```

- [ ] **Step 2: Helper `withSyncFresh`**

```ts
// web/src/lib/mcp/tools/sync.ts (suite)
export async function withSyncFresh<T>(
  groupId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensureSyncFresh(groupId, 'mcp');
  return fn();
}
```

- [ ] **Step 3: Intégrer dans tools sensibles**

Identifier les handlers de `list_ecritures`, `vue_ensemble`, `cw_list_rapprochement_bancaire` et wrap leur logique :

```ts
// Avant
async (args) => {
  const ecritures = await listEcritures({ groupId }, args);
  return { content: [...] };
}

// Après
async (args) => {
  return withSyncFresh(ctx.groupId, async () => {
    const ecritures = await listEcritures({ groupId }, args);
    return { content: [...] };
  });
}
```

- [ ] **Step 4: Register dans `register-all.ts`**

Mise à jour du compteur tools : `registerSyncTools` ajoute 1 tool → total 58 (3 + 54 + 1).

- [ ] **Step 5: Tests**

- `sync_run` sans force → success / skipped selon état
- `sync_run` avec force → success même si throttle
- `withSyncFresh` : si stale → runSyncCycle appelé + fn() appelée
- `withSyncFresh` : si fresh → runSyncCycle NON appelé, fn() appelée
- `list_ecritures` via MCP : check que ensureSyncFresh est trigger en amont (spy)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/mcp/tools/sync.ts \
        web/src/lib/mcp/tools/ecritures.ts \
        web/src/lib/mcp/tools/vue-ensemble.ts \
        web/src/lib/mcp/tools/comptaweb-client.ts \
        web/src/lib/mcp/register-all.ts \
        web/src/lib/mcp/tools/__tests__/sync.test.ts
git commit -m "feat(mcp): tool sync_run + withSyncFresh sur tools comptables"
```

---

## Task 6 : Composant client `<SyncStatusButton>` (header)

**Files:**
- Create: `web/src/components/sync/sync-status-button.tsx`
- Create: `web/src/components/sync/use-sync-status.ts` (hook)
- Modify: `web/src/app/(app)/layout.tsx` (monter le composant dans le header)
- Create: `web/src/components/sync/__tests__/sync-status-button.test.tsx`

- [ ] **Step 1: Hook `useSyncStatus`**

```tsx
// web/src/components/sync/use-sync-status.ts
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export type SyncState = 'idle' | 'running' | 'error';

export function useSyncStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [state, setState] = useState<SyncState>('idle');

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/sync/status');
    if (!res.ok) { setState('error'); return null; }
    const data = await res.json();
    setStatus(data);
    setState(data.is_running ? 'running' : 'idle');
    return data;
  }, []);

  const runSync = useCallback(async (force = false) => {
    setState('running');
    const url = force ? '/api/sync/run?force=1' : '/api/sync/run';
    const res = await fetch(url, { method: 'POST' });
    if (res.status === 429) {
      // throttled / already_running : pas une erreur, juste refetch
      await fetchStatus();
      return;
    }
    if (!res.ok) { setState('error'); return; }
    // Poll status until finished
    const pollInterval = setInterval(async () => {
      const s = await fetchStatus();
      if (!s?.is_running) {
        clearInterval(pollInterval);
        router.refresh();
      }
    }, 2000);
  }, [fetchStatus, router]);

  // Mount : check + auto-run si stale
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchStatus();
      if (cancelled) return;
      if (s?.stale && !s.is_running) {
        runSync(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchStatus, runSync]);

  // Refetch on tab focus
  useEffect(() => {
    const onVis = () => { if (!document.hidden) fetchStatus(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchStatus]);

  return { status, state, runSync };
}
```

- [ ] **Step 2: Composant `<SyncStatusButton>`**

```tsx
// web/src/components/sync/sync-status-button.tsx
'use client';
import { useSyncStatus } from './use-sync-status';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { formatRelative } from '@/lib/format';

export function SyncStatusButton() {
  const { status, state, runSync } = useSyncStatus();

  const label = state === 'running'
    ? 'Synchronisation…'
    : state === 'error'
    ? 'Échec sync — réessayer'
    : status?.last_run
    ? `synced ${formatRelative(status.last_run.finished_at!)}`
    : 'jamais sync';

  const Icon = state === 'running' ? RefreshCw
    : state === 'error' ? AlertTriangle
    : status?.stale ? AlertTriangle : Check;

  return (
    <button
      onClick={() => runSync(true)}
      disabled={state === 'running'}
      className="..."
      title={state === 'running' ? 'En cours' : 'Cliquer pour forcer la sync'}
    >
      <Icon className={state === 'running' ? 'animate-spin' : ''} />
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 3: Monter dans le layout**

```tsx
// web/src/app/(app)/layout.tsx (header)
import { SyncStatusButton } from '@/components/sync/sync-status-button';

// Dans le JSX du header, à côté du menu user :
<SyncStatusButton />
```

Visible uniquement pour les rôles ADMIN (treso/RG). Pour les autres rôles, ne pas le render.

- [ ] **Step 4: Tests React Testing Library**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SyncStatusButton } from '../sync-status-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('<SyncStatusButton>', () => {
  it('affiche "jamais sync" puis lance auto-sync au mount', async () => {
    mockFetch('/api/sync/status', { last_run: null, is_running: false, stale: true });
    mockFetch('/api/sync/run', { sync_run_id: 's1', status: 'ok' });
    render(<SyncStatusButton />);
    await waitFor(() => expect(screen.getByText(/Synchronisation/)).toBeInTheDocument());
  });

  it('affiche "synced il y a X" quand fresh', async () => { /* ... */ });
  it('clic = force sync', async () => { /* ... */ });
  it('429 = pas une erreur, refetch status', async () => { /* ... */ });
  it('polling toutes les 2s pendant running', async () => { /* ... */ });
  it('router.refresh appelé quand sync fini', async () => { /* ... */ });
});
```

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sync/ web/src/app/\(app\)/layout.tsx
git commit -m "feat(ui): SyncStatusButton header avec useSyncStatus hook"
```

---

## Task 7 : Détection stale `pending_sync > 1h` (log minimal)

**Files:**
- Modify: `web/src/lib/services/sync-cycle.ts` (ajouter `detectStalePendingSync` dans le cycle)
- Modify: `web/src/lib/services/__tests__/sync-cycle.test.ts`

- [ ] **Step 1: Fonction `detectStalePendingSync`**

```ts
async function detectStalePendingSync(db, groupId, syncRunId): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const stale = await db.prepare(
    `SELECT COUNT(*) as c FROM ecritures
     WHERE group_id = ? AND status = 'pending_sync'
       AND updated_at < ?`
  ).get(groupId, oneHourAgo);

  if (stale.c > 0) {
    logError('sync-cycle', 'stale_pending_sync', null, {
      groupId, syncRunId, count: stale.c,
    });
    // Stocké dans le journal d'erreurs (visible /admin/errors), pas dans sync_runs
    // pour ne pas marquer le run failed (le run est sain, c'est une alerte)
  }
  return stale.c;
}
```

- [ ] **Step 2: Appel dans le cycle**

Dans `runSyncCycle`, juste avant le commit final OK, appeler `detectStalePendingSync` et inclure le count dans `sync_runs.error_message` si > 0 (mais status reste 'ok') :

```ts
const staleCount = await detectStalePendingSync(db, groupId, syncRunId);
const warningMessage = staleCount > 0
  ? `${staleCount} pending_sync stales > 1h`
  : null;

await db.prepare(
  `UPDATE sync_runs SET ..., error_message = ? WHERE id = ?`
).run(..., warningMessage, syncRunId);
```

- [ ] **Step 3: Tests**

- 0 stale → error_message null
- 2 stale → error_message contient "2 pending_sync stales > 1h", status reste 'ok'

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/services/sync-cycle.ts \
        web/src/lib/services/__tests__/sync-cycle.test.ts
git commit -m "feat(sync): detect stale pending_sync > 1h + warning au journal"
```

---

## Task 8 : Vérification end-to-end + doc + ADR

**Files:**
- Modify: `doc/decisions.md` (ADR-032)
- Modify: `CLAUDE.md` (mention sync_run dans outils MCP, optionnel)
- Verify: ensemble du flow en local avec credentials CW réels

- [ ] **Step 1: Vérification end-to-end local**

Procédure :

1. `pnpm dev` dans `web/`
2. Ouvrir `http://localhost:3000` en tant que trésorier
3. Vérifier que `<SyncStatusButton>` apparaît dans le header
4. Au mount, voir le sync se lancer (icône spin + texte "Synchronisation…")
5. Attendre la fin → vérifier que la page se refresh
6. Aller dans `/admin/errors` : vérifier qu'aucune erreur n'apparaît
7. Vérifier la table `sync_runs` via le shell sqlite : `pnpm tsx scripts/sqlite-shell.ts "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 5;"`
8. Cliquer le bouton → force sync (override throttle) → nouveau run en base
9. Côté MCP : appeler `vue_ensemble` depuis Claude.ai → vérifier qu'un `sync_runs` avec `trigger='mcp'` apparaît si stale
10. Test multi-groupes : ouvrir un 2e compte d'un autre groupe, vérifier que les syncs sont bien isolés (different `group_id` dans `sync_runs`)

**Aucun curl-only** : la spec demande qu'on teste l'UI côté navigateur (cf. CLAUDE.md).

- [ ] **Step 2: ADR-032**

Ajouter dans `doc/decisions.md` :

```markdown
## ADR-032 — Sync incrémental Comptaweb client-piloté

**Date** : 2026-05-XX (date de merge)
**Statut** : Acté
**Contexte** : Phase 2 du pivot V1 ([`specs/2026-05-19-baloo-sync-incremental-design.md`](specs/2026-05-19-baloo-sync-incremental-design.md), livrée via [`plans/2026-05-19-baloo-sync-incremental-phase-2.md`](plans/2026-05-19-baloo-sync-incremental-phase-2.md)).

### Décision

Quatre points actés :

1. **Sync client-piloté, pas de cron** : ...
2. **`scrapeListeEcritures(exercice)` est le canal de matching mirror** : ...
3. **Verrou par `group_id`** : ...
4. **Table `sync_runs` audit complet** : ...

### Conséquences

- ...

**Liens** : Commits Phase 2 sur `feat/phase-2-sync-incremental` (ou direct sur main si workflow différent). Code clé : `web/src/lib/services/sync-cycle.ts`, `web/src/components/sync/`, `web/src/lib/comptaweb/ecritures-list-scrape.ts`. Spec : ... Plan : ...
```

- [ ] **Step 3: Mise à jour CLAUDE.md (optionnel)**

Ajouter une mention du tool `sync_run` dans la liste des tools MCP.

- [ ] **Step 4: Vérification finale tests + build**

```bash
cd web
pnpm vitest run          # tous les tests passent (cible ~321)
pnpm tsc --noEmit        # 0 erreur introduite (l'erreur pré-existante ecritures-create-cw-adapter.test.ts:87 reste, hors scope)
pnpm next build          # build local OK
```

- [ ] **Step 5: Commit final + push**

```bash
git add doc/decisions.md CLAUDE.md
git commit -m "doc(adr): ADR-032 sync incrémental Comptaweb (clôture Phase 2)"

# Demander accord push à l'utilisateur avant : memory feedback_pas_de_push_sans_accord
git push origin main
```

Annoncer à l'utilisateur :
- Tests pass : X / X
- Cold start prod à surveiller (migration `sync_runs` créée au démarrage)
- Surveiller `/admin/errors` après push pour repérer parse fail `scrapeListeEcritures` éventuel

---

## Notes d'exécution

- **Branche** : décision à prendre en début de plan. Soit `feat/phase-2-sync-incremental` (workflow PR), soit direct sur main (workflow Phase 1). Demander à l'utilisateur en début de Task 1.
- **Tests à chaque task** : exécuter `pnpm vitest run <scope>` après chaque Task. Si une régression apparaît dans un test non lié, investiguer avant de continuer (pas de skip).
- **Aucun DELETE** : règle absolue. Tous les updates passent par UPDATE avec COALESCE sur les champs Baloo-enrichis.
- **Cold start prod** : la migration `sync_runs` se joue au premier appel après déploiement. Surveiller logs Vercel après push.
- **Fixtures CW** : Task 2 dépend d'une session CW. Si fixtures impossibles à capturer (CW down, session expirée), pivoter sur des fixtures synthétiques + flag "à valider en prod avant Phase 3".
