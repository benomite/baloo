// Orchestrateur de la sync incrémentale Comptaweb (Phase 2 du pivot
// miroir strict). Un cycle = :
//   1. Vérifie le throttle 15 min + verrou running < 60 s (par groupe)
//   2. INSERT sync_runs(status='running')
//   3. Scrape liste écritures + rapprochement bancaire (parallèle)
//   4. Promote pending_sync → mirror par match cw_numero_piece
//   5. Upsert drafts orphelins depuis les lignes bancaires non rapprochées
//   6. Détecte les écritures divergentes (montant ou type ne matche pas CW)
//   7. Détecte les pending_sync stales > 1h (warning)
//   8. UPDATE sync_runs avec status final + counts
//
// Référence : doc/specs/2026-05-19-baloo-sync-incremental-design.md.
//
// Le service expose aussi :
//   - getSyncStatus(groupId) → pour l'endpoint GET /api/sync/status
//   - ensureSyncFresh(groupId, trigger) → helper bloquant pour tools MCP
//
// Pattern d'injection (comme `createEcritureAndPushToCw`) : le scraper
// et le config loader sont passés en options pour faciliter les tests.

import type { DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { logError } from '../log';
import { loadConfig as defaultLoadConfig } from '../comptaweb/auth';
import {
  scrapeListeEcritures as defaultScrapeListe,
  listRapprochementBancaire as defaultScrapeRapp,
} from '../comptaweb';
import type {
  ComptawebConfig,
  CwEcritureRow,
  RapprochementBancaireData,
  ScrapeListeEcrituresResult,
} from '../comptaweb/types';
import { scanDraftsFromComptaweb } from './drafts';

// ============================================================================
// Types publics
// ============================================================================

export type SyncTrigger = 'client' | 'mcp' | 'manual';
export type SyncRunStatus = 'running' | 'ok' | 'failed' | 'skipped';
export type SkipReason = 'throttled' | 'already_running';

export interface SyncCycleOptions {
  trigger: SyncTrigger;
  force?: boolean;
  /** Injection pour tests : charge la config CW. */
  loadConfig?: () => Promise<ComptawebConfig>;
  /** Injection pour tests : scrape la liste CW. */
  scrapeListe?: (cfg: ComptawebConfig) => Promise<ScrapeListeEcrituresResult>;
  /** Injection pour tests : scrape le rapprochement bancaire. */
  scrapeRapprochement?: (cfg: ComptawebConfig) => Promise<RapprochementBancaireData>;
  /** Injection pour tests : scan drafts depuis lignes bancaires. */
  scanDrafts?: (groupId: string) => Promise<{ crees: number; existants: number; erreur?: string }>;
  /** Injection pour tests : maintenant (ms epoch). Sinon Date.now(). */
  now?: () => number;
}

export interface SyncCycleResult {
  sync_run_id: string;
  status: SyncRunStatus;
  promoted_to_mirror: number;
  new_drafts: number;
  updated_drafts: number;
  divergent_detected: number;
  duration_ms: number;
  error_message?: string;
  skipped_reason?: SkipReason;
}

export interface SyncRunRow {
  id: string;
  group_id: string;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  trigger: SyncTrigger;
  promoted_to_mirror: number;
  new_drafts: number;
  updated_drafts: number;
  divergent_detected: number;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface SyncStatus {
  group_id: string;
  last_run: SyncRunRow | null;
  is_running: boolean;
  stale: boolean;
  throttle_until: string | null;
}

// ============================================================================
// Constantes
// ============================================================================

const THROTTLE_MS = 15 * 60 * 1000; // 15 min
const RUNNING_LOCK_MS = 60 * 1000; // 60 s : au-delà on considère le run zombie
const STALE_PENDING_SYNC_MS = 60 * 60 * 1000; // 1 h

// ============================================================================
// getSyncStatus
// ============================================================================

export async function getSyncStatus(
  db: DbWrapper,
  groupId: string,
  opts: { now?: () => number } = {},
): Promise<SyncStatus> {
  const now = opts.now ? opts.now() : Date.now();

  const lastRun = await db
    .prepare(
      `SELECT * FROM sync_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get<SyncRunRow>(groupId);

  if (!lastRun) {
    return { group_id: groupId, last_run: null, is_running: false, stale: true, throttle_until: null };
  }

  const startedAt = Date.parse(lastRun.started_at);
  const isRunning = lastRun.status === 'running' && now - startedAt < RUNNING_LOCK_MS;

  // Fenêtre du throttle : référence = dernier run terminé OK (skipped/failed
  // ne réinitialisent pas la fenêtre, sinon un run cassé bloque tout).
  const referenceTime = lastRun.status === 'ok' && lastRun.finished_at
    ? Date.parse(lastRun.finished_at)
    : null;

  const stale = referenceTime === null || now - referenceTime > THROTTLE_MS;
  const throttleUntil = referenceTime ? new Date(referenceTime + THROTTLE_MS).toISOString() : null;

  return {
    group_id: groupId,
    last_run: lastRun,
    is_running: isRunning,
    stale,
    throttle_until: throttleUntil,
  };
}

// ============================================================================
// shouldSkip
// ============================================================================

async function shouldSkip(
  db: DbWrapper,
  groupId: string,
  force: boolean,
  now: number,
): Promise<{ skip: boolean; reason?: SkipReason }> {
  const lastRun = await db
    .prepare(
      `SELECT status, started_at, finished_at FROM sync_runs
       WHERE group_id = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get<{ status: SyncRunStatus; started_at: string; finished_at: string | null }>(groupId);

  if (!lastRun) return { skip: false };

  // Verrou running : un autre cycle est encore vivant.
  if (lastRun.status === 'running') {
    const age = now - Date.parse(lastRun.started_at);
    if (age < RUNNING_LOCK_MS) return { skip: true, reason: 'already_running' };
    // Au-delà de RUNNING_LOCK_MS : run zombie (timeout serverless, crash).
    // On laisse passer le nouveau run.
  }

  if (force) return { skip: false };

  // Throttle 15 min : on regarde le dernier run OK.
  if (lastRun.status === 'ok' && lastRun.finished_at) {
    const sinceLastOk = now - Date.parse(lastRun.finished_at);
    if (sinceLastOk < THROTTLE_MS) return { skip: true, reason: 'throttled' };
  }

  return { skip: false };
}

// ============================================================================
// promotePendingSyncToMirror
// ============================================================================

interface PendingSyncRow {
  id: string;
  cw_numero_piece: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  date_ecriture: string;
}

/**
 * Pour chaque écriture Baloo `pending_sync`, tente de la matcher avec
 * une ligne CW par `cw_numero_piece` (qui contient l'ID interne CW en
 * Phase 1, cf. ecritures-create-cw-adapter.ts:184). Si match :
 *  - Compare montant + type → si divergent, status='divergent' + count
 *  - Sinon : status='mirror', et on remplace cw_numero_piece par le
 *    vrai numéro de pièce CW (texte ECR-YYYY-N) pour rendre l'identifiant
 *    lisible.
 *
 * Retourne { promoted, divergent } : les écritures non matchées restent
 * en pending_sync (re-tentera prochain cycle).
 */
async function promotePendingSyncToMirror(
  db: DbWrapper,
  groupId: string,
  cwEcritures: CwEcritureRow[],
): Promise<{ promoted: number; divergent: number }> {
  const pendings = await db
    .prepare(
      `SELECT id, cw_numero_piece, amount_cents, type, date_ecriture
       FROM ecritures
       WHERE group_id = ? AND status = 'pending_sync' AND cw_numero_piece IS NOT NULL`,
    )
    .all<PendingSyncRow>(groupId);

  if (pendings.length === 0) return { promoted: 0, divergent: 0 };

  // Index par String(id) ET par numeroPiece pour matcher les deux cas
  // (Phase 1 stocke l'id interne ; après promotion on stocke le numero).
  const byCwId = new Map<string, CwEcritureRow>();
  const byNumeroPiece = new Map<string, CwEcritureRow>();
  for (const row of cwEcritures) {
    byCwId.set(String(row.id), row);
    if (row.numeroPiece) byNumeroPiece.set(row.numeroPiece, row);
  }

  let promoted = 0;
  let divergent = 0;
  const updatedAt = currentTimestamp();

  for (const p of pendings) {
    const cw = byCwId.get(p.cw_numero_piece) ?? byNumeroPiece.get(p.cw_numero_piece);
    if (!cw) continue;

    const montantMatch = cw.montantCentimes === p.amount_cents;
    const typeMatch = cw.type === p.type;

    if (!montantMatch || !typeMatch) {
      await db
        .prepare(
          `UPDATE ecritures SET status = 'divergent', updated_at = ? WHERE id = ?`,
        )
        .run(updatedAt, p.id);
      divergent++;
      logError('sync-cycle', 'divergent_detected', null, {
        ecritureId: p.id,
        cwId: cw.id,
        baloo: { amount: p.amount_cents, type: p.type, date: p.date_ecriture },
        cw: {
          amount: cw.montantCentimes,
          type: cw.type,
          date: cw.dateEcriture,
          numeroPiece: cw.numeroPiece,
        },
      });
      continue;
    }

    // OK : promote en mirror et remplace cw_numero_piece par le vrai
    // numéro de pièce CW si différent (Phase 1 stocke souvent l'id
    // interne ; on l'enrichit avec le texte ECR-YYYY-N).
    const nouveauNum = cw.numeroPiece || p.cw_numero_piece;
    await db
      .prepare(
        `UPDATE ecritures SET status = 'mirror', cw_numero_piece = ?, updated_at = ? WHERE id = ?`,
      )
      .run(nouveauNum, updatedAt, p.id);
    promoted++;
  }

  return { promoted, divergent };
}

// ============================================================================
// detectStalePendingSync
// ============================================================================

async function detectStalePendingSync(
  db: DbWrapper,
  groupId: string,
  now: number,
): Promise<number> {
  const cutoff = new Date(now - STALE_PENDING_SYNC_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) as c FROM ecritures
       WHERE group_id = ? AND status = 'pending_sync' AND updated_at < ?`,
    )
    .get<{ c: number }>(groupId, cutoff);
  return row?.c ?? 0;
}

// ============================================================================
// runSyncCycle
// ============================================================================

export async function runSyncCycle(
  db: DbWrapper,
  groupId: string,
  opts: SyncCycleOptions,
): Promise<SyncCycleResult> {
  const nowFn = opts.now ?? (() => Date.now());
  const startMs = nowFn();
  const startedAt = new Date(startMs).toISOString();

  // 1. Throttle + verrou
  const skip = await shouldSkip(db, groupId, opts.force === true, startMs);
  if (skip.skip) {
    return {
      sync_run_id: '',
      status: 'skipped',
      promoted_to_mirror: 0,
      new_drafts: 0,
      updated_drafts: 0,
      divergent_detected: 0,
      duration_ms: 0,
      skipped_reason: skip.reason,
    };
  }

  // 2. INSERT sync_runs(running)
  // On scope `nextIdOn` à la table `sync_runs` : c'est la seule qui
  // utilise le prefix `SYNC`, et ça évite les UNION sur des tables
  // métier absentes dans les BDDs de test minimales.
  const syncRunId = await nextIdOn(db, 'SYNC', { tables: ['sync_runs'] });
  await db
    .prepare(
      `INSERT INTO sync_runs (id, group_id, started_at, status, trigger, created_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    )
    .run(syncRunId, groupId, startedAt, opts.trigger, startedAt);

  try {
    const loadConfig = opts.loadConfig ?? defaultLoadConfig;
    const scrapeListe = opts.scrapeListe ?? defaultScrapeListe;
    const scrapeRapprochement = opts.scrapeRapprochement ?? defaultScrapeRapp;
    const scanDrafts =
      opts.scanDrafts ?? (async (gid: string) => scanDraftsFromComptaweb({ groupId: gid }));

    const config = await loadConfig();

    // 3. Scrape parallèle liste + rapprochement
    const [listeResult] = await Promise.all([
      scrapeListe(config),
      scrapeRapprochement(config), // appelé pour cache HTTP, mais résultat
      // est utilisé via scanDrafts qui re-scrape côté drafts.ts. À la Phase 4
      // on factorisera ; pour Phase 2 on accepte la double lecture car
      // scanDraftsFromComptaweb pilote son propre scrape via withAutoReLogin.
    ]);

    // 4. Promote pending_sync → mirror
    const { promoted, divergent } = await promotePendingSyncToMirror(
      db,
      groupId,
      listeResult.ecritures,
    );

    // 5. Upsert drafts orphelins
    const draftsResult = await scanDrafts(groupId);
    const newDrafts = draftsResult.crees;
    // `existants` n'est pas "updated" — c'est juste un compteur de
    // collisions où on n'a rien changé. updated_drafts reste à 0 pour
    // Phase 2 (la mise à jour des drafts existants viendra en Phase 4
    // avec la résolution divergent).
    const updatedDrafts = 0;

    // 6. Détection stale (warning, pas erreur)
    const staleCount = await detectStalePendingSync(db, groupId, startMs);
    const warningMessage = staleCount > 0
      ? `${staleCount} pending_sync stales > 1h`
      : null;
    if (staleCount > 0) {
      logError('sync-cycle', 'stale_pending_sync', null, {
        groupId,
        syncRunId,
        count: staleCount,
      });
    }

    const endMs = nowFn();
    const durationMs = endMs - startMs;
    const finishedAt = new Date(endMs).toISOString();

    await db
      .prepare(
        `UPDATE sync_runs SET
           finished_at = ?, status = 'ok',
           promoted_to_mirror = ?, new_drafts = ?, updated_drafts = ?,
           divergent_detected = ?, error_message = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(
        finishedAt,
        promoted,
        newDrafts,
        updatedDrafts,
        divergent,
        warningMessage,
        durationMs,
        syncRunId,
      );

    return {
      sync_run_id: syncRunId,
      status: 'ok',
      promoted_to_mirror: promoted,
      new_drafts: newDrafts,
      updated_drafts: updatedDrafts,
      divergent_detected: divergent,
      duration_ms: durationMs,
      error_message: warningMessage ?? undefined,
    };
  } catch (err) {
    const endMs = nowFn();
    const durationMs = endMs - startMs;
    const finishedAt = new Date(endMs).toISOString();
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .prepare(
        `UPDATE sync_runs SET
           finished_at = ?, status = 'failed', error_message = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(finishedAt, errorMessage, durationMs, syncRunId);

    logError('sync-cycle', 'runSyncCycle failed', err, { groupId, syncRunId });

    return {
      sync_run_id: syncRunId,
      status: 'failed',
      promoted_to_mirror: 0,
      new_drafts: 0,
      updated_drafts: 0,
      divergent_detected: 0,
      duration_ms: durationMs,
      error_message: errorMessage,
    };
  }
}

// ============================================================================
// ensureSyncFresh
// ============================================================================

/**
 * Helper destiné aux tools MCP comptables (`list_ecritures`,
 * `vue_ensemble`, etc.) : si la dernière sync est stale (>15 min),
 * lance un cycle de sync **bloquant** avant de retourner. Sinon
 * no-op immédiat.
 *
 * Pour le pattern client-piloté côté front, on n'utilise pas cette
 * fonction : c'est le composant `<SyncStatusButton>` qui pilote.
 */
export async function ensureSyncFresh(
  db: DbWrapper,
  groupId: string,
  trigger: SyncTrigger,
  opts: Pick<SyncCycleOptions, 'loadConfig' | 'scrapeListe' | 'scrapeRapprochement' | 'scanDrafts' | 'now'> = {},
): Promise<void> {
  const status = await getSyncStatus(db, groupId, { now: opts.now });
  if (!status.stale || status.is_running) return;
  await runSyncCycle(db, groupId, { trigger, ...opts });
}
