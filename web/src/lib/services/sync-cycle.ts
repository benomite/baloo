// Orchestrateur de la RÉCONCILIATION Comptaweb (spec 2026-06-01, ADR-035 ;
// révise la promotion one-way de la Phase 2 / ADR-032).
//
// CW est la source de vérité. Un cycle aligne la liste Baloo sur CW :
//   1. shouldSkip (throttle 15 min + verrou 60 s) — inchangé vs ADR-032
//   2. INSERT sync_runs(running)
//   3. scanDrafts (drafts depuis lignes bancaires non rapprochées) — inchangé
//   4. scrape liste (scope) → snapshot CW
//   5. heal : backfill comptaweb_ecriture_id des écritures reliées au
//      vieux format (cw_numero_piece texte) via le mapping numéroPièce→id
//   6. reconcile(snapshot, balooRows) → plan d'actions (pur)
//   7. exécute le plan : updates (CW écrase) / promotions (draft→mirror) /
//      deletions (→supprimee_cw) / imports (→mirror) / suggestions de lien
//      L'enrichissement détail (activité/branche) est INCRÉMENTAL.
//   8. detectStalePendingSync (warning) — inchangé
//   9. UPDATE sync_runs(ok, counts…)
//
// Pattern d'injection (scraper, config, scanDrafts, scrapeDetail, resolvers)
// pour des tests sans réseau ni credentials.

import type { DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { logError } from '../log';
import { loadConfig as defaultLoadConfig } from '../comptaweb/auth';
import {
  scrapeListeEcritures as defaultScrapeListe,
  scrapeEcritureDetail as defaultScrapeDetail,
} from '../comptaweb';
import type { EcritureDetail, SyncScope } from '../comptaweb';
import type {
  ComptawebConfig,
  CwEcritureRow,
  RapprochementBancaireData,
  ScrapeListeEcrituresResult,
} from '../comptaweb/types';
import { scanDraftsFromComptaweb } from './drafts';
import {
  reconcile,
  computeCwSignature,
  type CwSnapshotRow,
  type BalooRow,
} from './ecritures-sync-reconcile';
import { upsertSuggestion } from './cw-link-suggestions';

// ============================================================================
// Types publics
// ============================================================================

export type SyncTrigger = 'client' | 'mcp' | 'manual';
export type SyncRunStatus = 'running' | 'ok' | 'failed' | 'skipped';
export type SkipReason = 'throttled' | 'already_running';

/** Tolérance de date (jours) pour le match contenu des drafts. */
const DRAFT_DATE_TOLERANCE_DAYS = 3;

export interface SyncCycleOptions {
  trigger: SyncTrigger;
  force?: boolean;
  /** Étendue de la fenêtre (défaut 'recent'). */
  scope?: SyncScope;
  /** Injection pour tests : charge la config CW. */
  loadConfig?: () => Promise<ComptawebConfig>;
  /** Injection pour tests : scrape la liste CW. */
  scrapeListe?: (cfg: ComptawebConfig, scope: SyncScope) => Promise<ScrapeListeEcrituresResult>;
  /** Injection pour tests : scrape le rapprochement bancaire. */
  scrapeRapprochement?: (cfg: ComptawebConfig) => Promise<RapprochementBancaireData>;
  /** Injection pour tests : scan drafts depuis lignes bancaires. */
  scanDrafts?: (groupId: string) => Promise<{ crees: number; existants: number; erreur?: string }>;
  /** Injection pour tests : lit la page détail CW d'une écriture. */
  scrapeDetail?: (cwId: number) => Promise<EcritureDetail>;
  /** Injection pour tests : résout un nom d'activité CW → activite_id Baloo. */
  resolveActiviteId?: (name: string) => Promise<string | null>;
  /** Injection pour tests : résout une branche/projet CW → unite_id Baloo. */
  resolveUniteId?: (branche: string) => Promise<string | null>;
  /** Injection pour tests : résout une nature CW → category_id Baloo. */
  resolveCategoryId?: (nature: string) => Promise<string | null>;
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
  updated_mirror: number;
  supprimee_cw_detected: number;
  imported_from_cw: number;
  link_suggestions_created: number;
  detail_fetches: number;
  scope: SyncScope;
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
  updated_mirror: number;
  supprimee_cw_detected: number;
  imported_from_cw: number;
  link_suggestions_created: number;
  detail_fetches: number;
  scope: string | null;
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
    .prepare(`SELECT * FROM sync_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get<SyncRunRow>(groupId);

  if (!lastRun) {
    return { group_id: groupId, last_run: null, is_running: false, stale: true, throttle_until: null };
  }

  const startedAt = Date.parse(lastRun.started_at);
  const isRunning = lastRun.status === 'running' && now - startedAt < RUNNING_LOCK_MS;

  const referenceTime =
    lastRun.status === 'ok' && lastRun.finished_at ? Date.parse(lastRun.finished_at) : null;

  const stale = referenceTime === null || now - referenceTime > THROTTLE_MS;
  const throttleUntil = referenceTime ? new Date(referenceTime + THROTTLE_MS).toISOString() : null;

  return { group_id: groupId, last_run: lastRun, is_running: isRunning, stale, throttle_until: throttleUntil };
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

  if (lastRun.status === 'running') {
    const age = now - Date.parse(lastRun.started_at);
    if (age < RUNNING_LOCK_MS) return { skip: true, reason: 'already_running' };
  }

  if (force) return { skip: false };

  if (lastRun.status === 'ok' && lastRun.finished_at) {
    const sinceLastOk = now - Date.parse(lastRun.finished_at);
    if (sinceLastOk < THROTTLE_MS) return { skip: true, reason: 'throttled' };
  }

  return { skip: false };
}

// ============================================================================
// Helpers de réconciliation
// ============================================================================

/** Convertit une ligne liste CW en ligne snapshot (avec signature). */
function toSnapshotRow(row: CwEcritureRow): CwSnapshotRow {
  return {
    cwId: row.id,
    numeroPiece: row.numeroPiece,
    date: row.dateEcriture,
    type: row.type,
    montantCents: row.montantCentimes,
    intitule: row.intitule,
    modeTransaction: row.modeTransaction,
    categorieTiers: row.categorieTiers,
    signature: computeCwSignature({
      date: row.dateEcriture,
      type: row.type,
      montantCents: row.montantCentimes,
      intitule: row.intitule,
      numeroPiece: row.numeroPiece,
      modeTransaction: row.modeTransaction,
      categorieTiers: row.categorieTiers,
    }),
  };
}

/**
 * « Heal » : pour les écritures Baloo reliées au vieux format (Phase 2 :
 * cw_numero_piece = numéro de pièce texte, comptaweb_ecriture_id NULL), on
 * pose comptaweb_ecriture_id depuis le mapping numéroPièce→id du snapshot.
 * Idempotent (ne touche que les NULL). Rend ces écritures matchables par
 * clé stable (et donc re-synchronisables).
 */
async function healComptawebIds(
  db: DbWrapper,
  groupId: string,
  snapshot: CwSnapshotRow[],
): Promise<void> {
  for (const row of snapshot) {
    if (!row.numeroPiece) continue;
    await db
      .prepare(
        `UPDATE ecritures SET comptaweb_ecriture_id = ?
         WHERE group_id = ? AND comptaweb_ecriture_id IS NULL AND cw_numero_piece = ?`,
      )
      .run(row.cwId, groupId, row.numeroPiece);
  }
}

/** Charge les écritures candidates à la réconciliation. */
async function loadBalooRows(db: DbWrapper, groupId: string): Promise<BalooRow[]> {
  return db
    .prepare(
      `SELECT id, status, comptaweb_ecriture_id, amount_cents, type, date_ecriture,
              cw_signature, activite_id, unite_id, category_id
       FROM ecritures
       WHERE group_id = ? AND status IN ('mirror','pending_sync','divergent','draft')`,
    )
    .all<{
      id: string;
      status: string;
      comptaweb_ecriture_id: number | null;
      amount_cents: number;
      type: 'depense' | 'recette';
      date_ecriture: string;
      cw_signature: string | null;
      activite_id: string | null;
      unite_id: string | null;
      category_id: string | null;
    }>(groupId)
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        comptawebEcritureId: r.comptaweb_ecriture_id,
        amountCents: r.amount_cents,
        type: r.type,
        dateEcriture: r.date_ecriture,
        cwSignature: r.cw_signature,
        hasImputation: r.activite_id != null || r.unite_id != null || r.category_id != null,
      })),
    );
}

interface Resolvers {
  scrapeDetail: (cwId: number) => Promise<EcritureDetail>;
  resolveActiviteId: (name: string) => Promise<string | null>;
  resolveUniteId: (branche: string) => Promise<string | null>;
  resolveCategoryId: (nature: string) => Promise<string | null>;
}

interface ResolvedIds {
  activiteId: string | null;
  uniteId: string | null;
  categoryId: string | null;
}

/**
 * Lit le détail CW et résout activite_id / unite_id / category_id. Renvoie
 * aussi le nombre de fetch effectués (0 ou 1) pour le compteur.
 */
async function fetchDetailIds(
  cwId: number,
  r: Resolvers,
): Promise<ResolvedIds & { fetched: number }> {
  try {
    const detail = await r.scrapeDetail(cwId);
    const activiteId = detail.activite ? await r.resolveActiviteId(detail.activite) : null;
    const uniteId = detail.brancheprojet ? await r.resolveUniteId(detail.brancheprojet) : null;
    const categoryId = detail.nature ? await r.resolveCategoryId(detail.nature) : null;
    return { activiteId, uniteId, categoryId, fetched: 1 };
  } catch (err) {
    // Le détail ne doit jamais bloquer la sync.
    logError('sync-cycle', 'scrapeEcritureDetail failed', err, { cwId });
    return { activiteId: null, uniteId: null, categoryId: null, fetched: 0 };
  }
}

/**
 * Pose sur une écriture les champs comptables venus de CW (CW écrase) + le
 * statut mirror. N'écrase jamais activite_id/unite_id par NULL : on ne pose
 * que les valeurs résolues (évite de perdre une imputation quand le mapping
 * de référentiel échoue). Notes/justifs/liens jamais touchés.
 */
async function writeCwFields(
  db: DbWrapper,
  ecritureId: string,
  cw: CwSnapshotRow,
  ids: { activiteId: string | null; uniteId: string | null; categoryId: string | null },
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ecritures SET
         date_ecriture = ?, description = ?, amount_cents = ?, type = ?,
         numero_piece = ?, cw_numero_piece = ?, comptaweb_ecriture_id = ?,
         cw_signature = ?, status = 'mirror', comptaweb_synced = 1,
         activite_id = COALESCE(?, activite_id),
         unite_id = COALESCE(?, unite_id),
         category_id = COALESCE(?, category_id),
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      cw.date,
      cw.intitule,
      cw.montantCents,
      cw.type,
      cw.numeroPiece,
      cw.numeroPiece,
      cw.cwId,
      cw.signature,
      ids.activiteId,
      ids.uniteId,
      ids.categoryId,
      now,
      ecritureId,
    );
}

// ============================================================================
// detectStalePendingSync
// ============================================================================

async function detectStalePendingSync(db: DbWrapper, groupId: string, now: number): Promise<number> {
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
// Resolvers BDD par défaut
// ============================================================================

function defaultResolveActiviteId(db: DbWrapper, groupId: string) {
  return async (name: string): Promise<string | null> => {
    const row = await db
      .prepare(`SELECT id FROM activites WHERE group_id = ? AND name = ? LIMIT 1`)
      .get<{ id: string }>(groupId, name);
    return row?.id ?? null;
  };
}

function defaultResolveUniteId(db: DbWrapper, groupId: string) {
  return async (branche: string): Promise<string | null> => {
    const row = await db
      .prepare(
        `SELECT id FROM unites WHERE group_id = ? AND (name = ? OR branche = ? OR code = ?) LIMIT 1`,
      )
      .get<{ id: string }>(groupId, branche, branche, branche);
    return row?.id ?? null;
  };
}

function defaultResolveCategoryId(db: DbWrapper, groupId: string) {
  return async (nature: string): Promise<string | null> => {
    // Priorité au libellé exact `comptaweb_nature` (100 % fiable), fallback
    // sur `name`. Cf. AGENTS.md « Mapping nature CSV → category_id ».
    const row = await db
      .prepare(
        `SELECT id FROM categories WHERE group_id = ? AND (comptaweb_nature = ? OR name = ?) LIMIT 1`,
      )
      .get<{ id: string }>(groupId, nature, nature);
    return row?.id ?? null;
  };
}

// ============================================================================
// resyncEcritureDetail — resync ciblé d'une écriture (bouton drawer)
// ============================================================================

export type ResyncResult =
  | { ok: true; activiteId: string | null; uniteId: string | null; categoryId: string | null }
  | { ok: false; reason: 'not_found' | 'not_linked' };

/**
 * Re-synchronise UNE écriture depuis CW (action manuelle, hors cycle) :
 * relit sa page détail, résout activité/unité/catégorie, et pose
 * `comptaweb_synced = 1` + `status = 'mirror'`. N'écrase jamais une
 * imputation par NULL (COALESCE) ni les enrichissements locaux.
 *
 * Utile pour réparer une écriture précise sans lancer un cycle complet
 * (notamment une écriture ancienne hors de la fenêtre `recent`).
 */
export async function resyncEcritureDetail(
  db: DbWrapper,
  groupId: string,
  ecritureId: string,
  opts: Pick<SyncCycleOptions, 'loadConfig' | 'scrapeDetail' | 'resolveActiviteId' | 'resolveUniteId' | 'resolveCategoryId'> = {},
): Promise<ResyncResult> {
  const ecr = await db
    .prepare('SELECT comptaweb_ecriture_id FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ comptaweb_ecriture_id: number | null }>(ecritureId, groupId);
  if (!ecr) return { ok: false, reason: 'not_found' };
  if (ecr.comptaweb_ecriture_id == null) return { ok: false, reason: 'not_linked' };

  const loadConfig = opts.loadConfig ?? defaultLoadConfig;
  const config = await loadConfig();
  const resolvers: Resolvers = {
    scrapeDetail: opts.scrapeDetail ?? ((cwId: number) => defaultScrapeDetail(config, cwId)),
    resolveActiviteId: opts.resolveActiviteId ?? defaultResolveActiviteId(db, groupId),
    resolveUniteId: opts.resolveUniteId ?? defaultResolveUniteId(db, groupId),
    resolveCategoryId: opts.resolveCategoryId ?? defaultResolveCategoryId(db, groupId),
  };

  const r = await fetchDetailIds(ecr.comptaweb_ecriture_id, resolvers);
  await db
    .prepare(
      `UPDATE ecritures SET
         status = 'mirror', comptaweb_synced = 1,
         activite_id = COALESCE(?, activite_id),
         unite_id = COALESCE(?, unite_id),
         category_id = COALESCE(?, category_id),
         updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(r.activiteId, r.uniteId, r.categoryId, currentTimestamp(), ecritureId, groupId);

  return { ok: true, activiteId: r.activiteId, uniteId: r.uniteId, categoryId: r.categoryId };
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
  const scope: SyncScope = opts.scope ?? 'recent';

  const empty = (over: Partial<SyncCycleResult>): SyncCycleResult => ({
    sync_run_id: '',
    status: 'skipped',
    promoted_to_mirror: 0,
    new_drafts: 0,
    updated_drafts: 0,
    divergent_detected: 0,
    updated_mirror: 0,
    supprimee_cw_detected: 0,
    imported_from_cw: 0,
    link_suggestions_created: 0,
    detail_fetches: 0,
    scope,
    duration_ms: 0,
    ...over,
  });

  // 1. Throttle + verrou
  const skip = await shouldSkip(db, groupId, opts.force === true, startMs);
  if (skip.skip) return empty({ skipped_reason: skip.reason });

  // 2. INSERT sync_runs(running)
  const syncRunId = await nextIdOn(db, 'SYNC', { tables: ['sync_runs'] });
  await db
    .prepare(
      `INSERT INTO sync_runs (id, group_id, started_at, status, trigger, scope, created_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
    )
    .run(syncRunId, groupId, startedAt, opts.trigger, scope, startedAt);

  try {
    const loadConfig = opts.loadConfig ?? defaultLoadConfig;
    const scrapeListe = opts.scrapeListe ?? defaultScrapeListe;
    const scanDrafts =
      opts.scanDrafts ?? (async (gid: string) => scanDraftsFromComptaweb({ groupId: gid }));

    const config = await loadConfig();

    const resolvers: Resolvers = {
      scrapeDetail: opts.scrapeDetail ?? ((cwId: number) => defaultScrapeDetail(config, cwId)),
      resolveActiviteId: opts.resolveActiviteId ?? defaultResolveActiviteId(db, groupId),
      resolveUniteId: opts.resolveUniteId ?? defaultResolveUniteId(db, groupId),
      resolveCategoryId: opts.resolveCategoryId ?? defaultResolveCategoryId(db, groupId),
    };

    // 3. Drafts depuis lignes bancaires non rapprochées (avant reconcile :
    //    les drafts créés ce cycle participent au match contenu).
    const draftsResult = await scanDrafts(groupId);
    const newDrafts = draftsResult.crees;

    // 4. Scrape liste → snapshot CW
    const listeResult = await scrapeListe(config, scope);
    const snapshot = listeResult.ecritures.map(toSnapshotRow);

    // 5. Heal des écritures reliées au vieux format
    await healComptawebIds(db, groupId, snapshot);

    // 6. Charge l'état Baloo + reconcile (pur)
    const balooRows = await loadBalooRows(db, groupId);
    const plan = reconcile(snapshot, balooRows, { dateToleranceDays: DRAFT_DATE_TOLERANCE_DAYS });

    const now = currentTimestamp();
    let updatedMirror = 0;
    let promoted = 0;
    let supprimeeCw = 0;
    let imported = 0;
    let suggestionsCreated = 0;
    let detailFetches = 0;

    // 7a. Updates (mirror/pending_sync reliés) — CW écrase.
    for (const u of plan.updates) {
      let ids: ResolvedIds = { activiteId: null, uniteId: null, categoryId: null };
      if (u.needsDetail) {
        const r = await fetchDetailIds(u.cw.cwId, resolvers);
        detailFetches += r.fetched;
        ids = { activiteId: r.activiteId, uniteId: r.uniteId, categoryId: r.categoryId };
      }
      await writeCwFields(db, u.ecritureId, u.cw, ids, now);
      updatedMirror++;
    }

    // 7b. Promotions (draft → mirror, match contenu confiant) — détail systématique.
    for (const p of plan.promotions) {
      const r = await fetchDetailIds(p.cw.cwId, resolvers);
      detailFetches += r.fetched;
      await writeCwFields(
        db,
        p.ecritureId,
        p.cw,
        { activiteId: r.activiteId, uniteId: r.uniteId, categoryId: r.categoryId },
        now,
      );
      promoted++;
    }

    // 7c. Deletions → supprimee_cw (jamais de DELETE).
    for (const ecritureId of plan.deletions) {
      await db
        .prepare(`UPDATE ecritures SET status = 'supprimee_cw', updated_at = ? WHERE id = ?`)
        .run(now, ecritureId);
      supprimeeCw++;
    }

    // 7d. Imports (lignes CW absentes) → création mirror + détail.
    for (const cw of plan.imports) {
      const r = await fetchDetailIds(cw.cwId, resolvers);
      detailFetches += r.fetched;
      const newId = await nextIdOn(db, 'ECR', { tables: ['ecritures'] });
      await db
        .prepare(
          `INSERT INTO ecritures
             (id, group_id, date_ecriture, description, amount_cents, type,
              numero_piece, cw_numero_piece, comptaweb_ecriture_id, cw_signature,
              status, comptaweb_synced, activite_id, unite_id, category_id,
              justif_attendu, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mirror', 1, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          newId,
          groupId,
          cw.date,
          cw.intitule,
          cw.montantCents,
          cw.type,
          cw.numeroPiece,
          cw.numeroPiece,
          cw.cwId,
          cw.signature,
          r.activiteId,
          r.uniteId,
          r.categoryId,
          now,
          now,
        );
      imported++;
    }

    // 7e. Suggestions de lien (match contenu ambigu).
    for (const s of plan.suggestions) {
      const created = await upsertSuggestion(db, {
        groupId,
        ecritureId: s.ecritureId,
        cwEcritureId: s.cw.cwId,
        cwNumeroPiece: s.cw.numeroPiece,
        cwMontantCents: s.cw.montantCents,
        cwDate: s.cw.date,
        cwIntitule: s.cw.intitule,
      });
      if (created) suggestionsCreated++;
    }

    // 8. Détection stale (warning, pas erreur)
    const staleCount = await detectStalePendingSync(db, groupId, startMs);
    const warningMessage = staleCount > 0 ? `${staleCount} pending_sync stales > 1h` : null;
    if (staleCount > 0) {
      logError('sync-cycle', 'stale_pending_sync', null, { groupId, syncRunId, count: staleCount });
    }

    const endMs = nowFn();
    const durationMs = endMs - startMs;
    const finishedAt = new Date(endMs).toISOString();

    // 9. UPDATE sync_runs(ok, counts)
    await db
      .prepare(
        `UPDATE sync_runs SET
           finished_at = ?, status = 'ok',
           promoted_to_mirror = ?, new_drafts = ?, updated_drafts = 0,
           divergent_detected = 0,
           updated_mirror = ?, supprimee_cw_detected = ?, imported_from_cw = ?,
           link_suggestions_created = ?, detail_fetches = ?,
           error_message = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(
        finishedAt,
        promoted,
        newDrafts,
        updatedMirror,
        supprimeeCw,
        imported,
        suggestionsCreated,
        detailFetches,
        warningMessage,
        durationMs,
        syncRunId,
      );

    return {
      sync_run_id: syncRunId,
      status: 'ok',
      promoted_to_mirror: promoted,
      new_drafts: newDrafts,
      updated_drafts: 0,
      divergent_detected: 0,
      updated_mirror: updatedMirror,
      supprimee_cw_detected: supprimeeCw,
      imported_from_cw: imported,
      link_suggestions_created: suggestionsCreated,
      detail_fetches: detailFetches,
      scope,
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
        `UPDATE sync_runs SET finished_at = ?, status = 'failed', error_message = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(finishedAt, errorMessage, durationMs, syncRunId);

    logError('sync-cycle', 'runSyncCycle failed', err, { groupId, syncRunId });

    return empty({ sync_run_id: syncRunId, status: 'failed', duration_ms: durationMs, error_message: errorMessage });
  }
}

// ============================================================================
// ensureSyncFresh
// ============================================================================

/**
 * Helper destiné aux tools MCP comptables : si la dernière sync est stale
 * (>15 min), lance un cycle bloquant avant de retourner. Sinon no-op.
 */
export async function ensureSyncFresh(
  db: DbWrapper,
  groupId: string,
  trigger: SyncTrigger,
  opts: Pick<
    SyncCycleOptions,
    | 'loadConfig'
    | 'scrapeListe'
    | 'scrapeRapprochement'
    | 'scanDrafts'
    | 'scrapeDetail'
    | 'resolveActiviteId'
    | 'resolveUniteId'
    | 'resolveCategoryId'
    | 'scope'
    | 'now'
  > = {},
): Promise<void> {
  const status = await getSyncStatus(db, groupId, { now: opts.now });
  if (!status.stale || status.is_running) return;
  await runSyncCycle(db, groupId, { trigger, ...opts });
}
