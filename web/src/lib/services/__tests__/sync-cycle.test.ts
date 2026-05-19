// Tests du service `runSyncCycle` et de ses satellites
// (`getSyncStatus`, `ensureSyncFresh`) — Phase 2 Task 3 du pivot miroir
// strict + MCP-first.
//
// Setup : BDD libsql in-memory avec un schéma minimal (`sync_runs` +
// `ecritures`) ; les scrapers Comptaweb sont injectés via les options
// pour ne dépendre ni du réseau ni des credentials.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema } from '../../db/business-schema';
import {
  runSyncCycle,
  getSyncStatus,
  ensureSyncFresh,
  type SyncCycleOptions,
} from '../sync-cycle';
import type {
  ComptawebConfig,
  CwEcritureRow,
  RapprochementBancaireData,
  ScrapeListeEcrituresResult,
} from '../../comptaweb/types';

// ---------------- Setup BDD minimaliste ----------------

const ECRITURES_DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL,
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    carte_id TEXT,
    numero_piece TEXT,
    cw_numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX idx_ecritures_group ON ecritures(group_id);
  CREATE INDEX idx_ecritures_cw_numero_piece ON ecritures(cw_numero_piece);
`;

async function setupDb(): Promise<{ client: Client; db: DbWrapper }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(ECRITURES_DDL);
  await ensureSyncRunsSchema(db);
  return { client, db };
}

async function insertEcriture(
  db: DbWrapper,
  overrides: Partial<{
    id: string;
    group_id: string;
    status: string;
    cw_numero_piece: string | null;
    amount_cents: number;
    type: 'depense' | 'recette';
    date_ecriture: string;
    description: string;
    updated_at: string;
  }> = {},
) {
  const now = '2026-05-19T12:00:00Z';
  const e = {
    id: 'ECR-2026-001',
    group_id: 'g1',
    status: 'pending_sync',
    cw_numero_piece: '2386515',
    amount_cents: 49100,
    type: 'depense' as const,
    date_ecriture: '2026-05-04',
    description: 'Test',
    updated_at: now,
    ...overrides,
  };
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, cw_numero_piece, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.id,
      e.group_id,
      e.date_ecriture,
      e.description,
      e.amount_cents,
      e.type,
      e.status,
      e.cw_numero_piece,
      e.updated_at,
    );
}

async function insertSyncRun(
  db: DbWrapper,
  overrides: {
    id?: string;
    group_id?: string;
    started_at: string;
    finished_at?: string | null;
    status: 'running' | 'ok' | 'failed' | 'skipped';
  },
) {
  const r = {
    id: 'SYNC-2026-000',
    group_id: 'g1',
    finished_at: null,
    ...overrides,
  };
  await db
    .prepare(
      `INSERT INTO sync_runs (id, group_id, started_at, finished_at, status, trigger, created_at)
       VALUES (?, ?, ?, ?, ?, 'client', ?)`,
    )
    .run(r.id, r.group_id, r.started_at, r.finished_at, r.status, r.started_at);
}

// ---------------- Mocks scrapers ----------------

const FAKE_CONFIG: ComptawebConfig = { baseUrl: 'http://test', cookie: 'fake' };

function makeRow(opts: Partial<CwEcritureRow>): CwEcritureRow {
  return {
    id: opts.id ?? 2386515,
    numeroPiece: opts.numeroPiece ?? 'ECR-2026-101',
    dateEcriture: opts.dateEcriture ?? '2026-05-04',
    type: opts.type ?? 'depense',
    intitule: opts.intitule ?? 'Test',
    montantCentimes: opts.montantCentimes ?? 49100,
    compteBancaire: opts.compteBancaire ?? 'GROUPE TEST',
    modeTransaction: opts.modeTransaction ?? 'Virement',
    categorieTiers: opts.categorieTiers ?? '',
    structureTiers: opts.structureTiers ?? '',
    rapproche: opts.rapproche ?? false,
  };
}

function mockOpts(opts: {
  ecritures?: CwEcritureRow[];
  rapproche?: RapprochementBancaireData;
  scanDrafts?: SyncCycleOptions['scanDrafts'];
  now?: () => number;
  trigger?: SyncCycleOptions['trigger'];
  force?: boolean;
  failScrape?: boolean;
}): SyncCycleOptions {
  return {
    trigger: opts.trigger ?? 'client',
    force: opts.force,
    now: opts.now,
    loadConfig: async () => FAKE_CONFIG,
    scrapeListe: async (): Promise<ScrapeListeEcrituresResult> => {
      if (opts.failScrape) throw new Error('CW down');
      return { ecritures: opts.ecritures ?? [] };
    },
    scrapeRapprochement: async (): Promise<RapprochementBancaireData> =>
      opts.rapproche ?? { idCompte: 1, libelleCompte: 'test', ecrituresComptables: [], ecrituresBancaires: [] },
    scanDrafts: opts.scanDrafts ?? (async () => ({ crees: 0, existants: 0 })),
  };
}

// ============================================================
// Tests
// ============================================================

describe('runSyncCycle — throttle + verrou', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('lance un run si aucun sync précédent', async () => {
    const res = await runSyncCycle(db, 'g1', mockOpts({ ecritures: [] }));
    expect(res.status).toBe('ok');
    expect(res.sync_run_id).toBeTruthy();
  });

  it('skip si last_run ok < 15 min', async () => {
    const now = new Date('2026-05-19T12:10:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-2026-001',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:30Z',
      status: 'ok',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('skipped');
    expect(res.skipped_reason).toBe('throttled');
  });

  it('force=true bypass le throttle', async () => {
    const now = new Date('2026-05-19T12:10:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-2026-001',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:30Z',
      status: 'ok',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now, force: true }));
    expect(res.status).toBe('ok');
  });

  it('skip si un run est en cours depuis < 60s', async () => {
    const now = new Date('2026-05-19T12:00:30Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-2026-001',
      started_at: '2026-05-19T12:00:00Z',
      status: 'running',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('skipped');
    expect(res.skipped_reason).toBe('already_running');
  });

  it('force ne bypass PAS le verrou running (sécurité)', async () => {
    const now = new Date('2026-05-19T12:00:30Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-2026-001',
      started_at: '2026-05-19T12:00:00Z',
      status: 'running',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now, force: true }));
    expect(res.status).toBe('skipped');
    expect(res.skipped_reason).toBe('already_running');
  });

  it('considère un running > 60s comme zombie et lance quand même', async () => {
    const now = new Date('2026-05-19T12:02:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-2026-001',
      started_at: '2026-05-19T12:00:00Z',
      status: 'running',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('ok');
  });

  it('un last_run failed ne fait pas throttle (on retente)', async () => {
    const now = new Date('2026-05-19T12:05:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-2026-001',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:10Z',
      status: 'failed',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('ok');
  });
});

describe('runSyncCycle — promotion pending_sync → mirror', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('promeut par match cw_numero_piece (id interne CW)', async () => {
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      cw_numero_piece: '2386515',
      amount_cents: 49100,
      type: 'depense',
    });
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [
          makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101', montantCentimes: 49100, type: 'depense' }),
        ],
      }),
    );
    expect(res.status).toBe('ok');
    expect(res.promoted_to_mirror).toBe(1);

    const ecr = await db
      .prepare('SELECT status, cw_numero_piece FROM ecritures WHERE id = ?')
      .get<{ status: string; cw_numero_piece: string }>('ECR-2026-001');
    expect(ecr).toEqual({ status: 'mirror', cw_numero_piece: 'ECR-2026-101' });
  });

  it('détecte divergent quand le montant Baloo ≠ montant CW', async () => {
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      cw_numero_piece: '2386515',
      amount_cents: 49100,
      type: 'depense',
    });
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [
          makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101', montantCentimes: 50000, type: 'depense' }),
        ],
      }),
    );
    expect(res.promoted_to_mirror).toBe(0);
    expect(res.divergent_detected).toBe(1);

    const ecr = await db
      .prepare('SELECT status FROM ecritures WHERE id = ?')
      .get<{ status: string }>('ECR-2026-001');
    expect(ecr?.status).toBe('divergent');
  });

  it('détecte divergent quand le type Baloo ≠ type CW', async () => {
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      cw_numero_piece: '2386515',
      amount_cents: 49100,
      type: 'depense',
    });
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [
          makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101', montantCentimes: 49100, type: 'recette' }),
        ],
      }),
    );
    expect(res.divergent_detected).toBe(1);
  });

  it('laisse en pending_sync si pas de match CW', async () => {
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      cw_numero_piece: '9999999',
    });
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101' })],
      }),
    );
    expect(res.promoted_to_mirror).toBe(0);

    const ecr = await db
      .prepare('SELECT status FROM ecritures WHERE id = ?')
      .get<{ status: string }>('ECR-2026-001');
    expect(ecr?.status).toBe('pending_sync');
  });

  it('ignore les écritures qui ne sont pas en pending_sync', async () => {
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'draft', cw_numero_piece: null });
    await insertEcriture(db, { id: 'ECR-2026-002', status: 'mirror', cw_numero_piece: '2386515' });
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [makeRow({ id: 2386515, montantCentimes: 49100, type: 'depense' })],
      }),
    );
    expect(res.promoted_to_mirror).toBe(0);
  });

  it('match aussi par numeroPiece (cas d un re-cycle après promotion)', async () => {
    // Après un premier cycle, cw_numero_piece a déjà été remplacé par
    // le vrai numéro CW. Le 2e cycle doit pouvoir re-matcher dessus.
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      status: 'pending_sync',
      cw_numero_piece: 'ECR-2026-101',
      amount_cents: 49100,
    });
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101', montantCentimes: 49100 })],
      }),
    );
    expect(res.promoted_to_mirror).toBe(1);
  });
});

describe('runSyncCycle — drafts orphelins', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('compte les nouveaux drafts retournés par scanDrafts', async () => {
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        scanDrafts: async () => ({ crees: 3, existants: 5 }),
      }),
    );
    expect(res.new_drafts).toBe(3);
    expect(res.updated_drafts).toBe(0);
  });

  it('continue le cycle même si scanDrafts retourne une erreur métier', async () => {
    // scanDrafts retourne une erreur applicative (session expirée) sans
    // throw : on doit quand même réussir le cycle (le run a déjà fait
    // la promotion mirror, on ne le marque pas failed pour des drafts).
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        scanDrafts: async () => ({ crees: 0, existants: 0, erreur: 'session expirée' }),
      }),
    );
    expect(res.status).toBe('ok');
    expect(res.new_drafts).toBe(0);
  });
});

describe('runSyncCycle — détection stale + erreurs', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('warning si pending_sync stale > 1h (status reste ok)', async () => {
    const now = new Date('2026-05-19T14:00:00Z').getTime();
    // pending_sync mise à jour à 12:30, soit 1h30 avant now.
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      status: 'pending_sync',
      cw_numero_piece: '9999999', // pas match
      updated_at: '2026-05-19T12:30:00Z',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('ok');
    expect(res.error_message).toMatch(/1 pending_sync stales > 1h/);
  });

  it('pas de warning si toutes les pending_sync sont récentes', async () => {
    const now = new Date('2026-05-19T12:15:00Z').getTime();
    await insertEcriture(db, {
      id: 'ECR-2026-001',
      status: 'pending_sync',
      cw_numero_piece: '9999999',
      updated_at: '2026-05-19T12:00:00Z',
    });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.error_message).toBeUndefined();
  });

  it('scraper throws → status failed + error_message renseigné', async () => {
    const res = await runSyncCycle(db, 'g1', mockOpts({ failScrape: true }));
    expect(res.status).toBe('failed');
    expect(res.error_message).toMatch(/CW down/);

    const row = await db
      .prepare('SELECT status, error_message FROM sync_runs WHERE id = ?')
      .get<{ status: string; error_message: string }>(res.sync_run_id);
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toMatch(/CW down/);
  });
});

describe('runSyncCycle — isolation multi-groupes', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('sync groupe A ne touche pas les écritures du groupe B', async () => {
    await insertEcriture(db, {
      id: 'ECR-2026-A1', group_id: 'g_a', cw_numero_piece: '111', amount_cents: 1000,
    });
    await insertEcriture(db, {
      id: 'ECR-2026-B1', group_id: 'g_b', cw_numero_piece: '111', amount_cents: 1000,
    });

    await runSyncCycle(
      db,
      'g_a',
      mockOpts({
        ecritures: [makeRow({ id: 111, montantCentimes: 1000 })],
      }),
    );

    const a = await db
      .prepare('SELECT status FROM ecritures WHERE id = ?')
      .get<{ status: string }>('ECR-2026-A1');
    const b = await db
      .prepare('SELECT status FROM ecritures WHERE id = ?')
      .get<{ status: string }>('ECR-2026-B1');
    expect(a?.status).toBe('mirror');
    expect(b?.status).toBe('pending_sync'); // intact
  });

  it('throttle par groupe : last_run g_a ne throttle pas g_b', async () => {
    const now = new Date('2026-05-19T12:05:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1', group_id: 'g_a',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:30Z',
      status: 'ok',
    });

    const resA = await runSyncCycle(db, 'g_a', mockOpts({ now: () => now }));
    const resB = await runSyncCycle(db, 'g_b', mockOpts({ now: () => now }));
    expect(resA.status).toBe('skipped'); // throttled
    expect(resB.status).toBe('ok'); // pas concerné
  });
});

// ============================================================
// getSyncStatus
// ============================================================

describe('getSyncStatus', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('renvoie stale=true et last_run=null si aucun run', async () => {
    const s = await getSyncStatus(db, 'g1');
    expect(s.last_run).toBeNull();
    expect(s.stale).toBe(true);
    expect(s.is_running).toBe(false);
    expect(s.throttle_until).toBeNull();
  });

  it('renvoie is_running=true pour un run récent en cours', async () => {
    const now = new Date('2026-05-19T12:00:30Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1',
      started_at: '2026-05-19T12:00:00Z',
      status: 'running',
    });
    const s = await getSyncStatus(db, 'g1', { now: () => now });
    expect(s.is_running).toBe(true);
  });

  it('is_running=false pour un running vieux (zombie)', async () => {
    const now = new Date('2026-05-19T12:05:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1',
      started_at: '2026-05-19T12:00:00Z',
      status: 'running',
    });
    const s = await getSyncStatus(db, 'g1', { now: () => now });
    expect(s.is_running).toBe(false);
  });

  it('renvoie stale=false et throttle_until pour un run ok récent', async () => {
    const now = new Date('2026-05-19T12:10:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:30Z',
      status: 'ok',
    });
    const s = await getSyncStatus(db, 'g1', { now: () => now });
    expect(s.stale).toBe(false);
    expect(s.throttle_until).toBe('2026-05-19T12:15:30.000Z');
  });

  it('renvoie stale=true si > 15 min depuis last_ok', async () => {
    const now = new Date('2026-05-19T12:30:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:30Z',
      status: 'ok',
    });
    const s = await getSyncStatus(db, 'g1', { now: () => now });
    expect(s.stale).toBe(true);
  });
});

// ============================================================
// ensureSyncFresh
// ============================================================

describe('ensureSyncFresh', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('no-op si fresh', async () => {
    const now = new Date('2026-05-19T12:05:00Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1',
      started_at: '2026-05-19T12:00:00Z',
      finished_at: '2026-05-19T12:00:30Z',
      status: 'ok',
    });
    let scraperCalled = false;
    await ensureSyncFresh(db, 'g1', 'mcp', {
      now: () => now,
      loadConfig: async () => FAKE_CONFIG,
      scrapeListe: async () => { scraperCalled = true; return { ecritures: [] }; },
    });
    expect(scraperCalled).toBe(false);
  });

  it('lance runSyncCycle si stale', async () => {
    let scraperCalled = false;
    await ensureSyncFresh(db, 'g1', 'mcp', {
      loadConfig: async () => FAKE_CONFIG,
      scrapeListe: async () => { scraperCalled = true; return { ecritures: [] }; },
      scanDrafts: async () => ({ crees: 0, existants: 0 }),
    });
    expect(scraperCalled).toBe(true);
  });

  it('no-op si un run est déjà en cours', async () => {
    const now = new Date('2026-05-19T12:00:30Z').getTime();
    await insertSyncRun(db, {
      id: 'SYNC-1',
      started_at: '2026-05-19T12:00:00Z',
      status: 'running',
    });
    let scraperCalled = false;
    await ensureSyncFresh(db, 'g1', 'mcp', {
      now: () => now,
      loadConfig: async () => FAKE_CONFIG,
      scrapeListe: async () => { scraperCalled = true; return { ecritures: [] }; },
    });
    expect(scraperCalled).toBe(false);
  });
});
