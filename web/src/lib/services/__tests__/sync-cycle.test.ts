// Tests du service `runSyncCycle` (réconciliation Comptaweb, spec 2026-06-01,
// ADR-035) et de ses satellites (`getSyncStatus`, `ensureSyncFresh`).
//
// Setup : BDD libsql in-memory ; les scrapers CW + le détail + les resolvers
// de référentiels sont injectés (ni réseau ni credentials).
//
// Régression conservée vs ADR-032 : throttle/verrou/stale/isolation/statut.
// Sémantique NOUVELLE : matching par clé stable comptaweb_ecriture_id,
// CW écrase (plus de divergent sur écart montant), suppressions, imports,
// suggestions de lien.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import {
  runSyncCycle,
  getSyncStatus,
  ensureSyncFresh,
  resyncEcritureDetail,
  type SyncCycleOptions,
} from '../sync-cycle';
import type {
  ComptawebConfig,
  CwEcritureRow,
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

  -- Tables satellites requises par loadVentCandidates (flags d'enrichissement).
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
`;

async function setupDb(): Promise<{ client: Client; db: DbWrapper }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(ECRITURES_DDL);
  await ensureSyncRunsSchema(db);
  await ensureReconcileSchema(db); // ajoute cw_signature, compteurs, cw_link_suggestions, backfill
  return { client, db };
}

async function insertEcriture(
  db: DbWrapper,
  overrides: Partial<{
    id: string;
    group_id: string;
    status: string;
    cw_numero_piece: string | null;
    comptaweb_ecriture_id: number | null;
    cw_signature: string | null;
    amount_cents: number;
    type: 'depense' | 'recette';
    date_ecriture: string;
    description: string;
    notes: string | null;
    updated_at: string;
  }> = {},
) {
  const now = '2026-05-19T12:00:00Z';
  const e = {
    id: 'ECR-2026-001',
    group_id: 'g1',
    status: 'pending_sync',
    cw_numero_piece: null,
    comptaweb_ecriture_id: null,
    cw_signature: null,
    amount_cents: 49100,
    type: 'depense' as const,
    date_ecriture: '2026-05-04',
    description: 'Test',
    notes: null,
    updated_at: now,
    ...overrides,
  };
  await db
    .prepare(
      `INSERT INTO ecritures
         (id, group_id, date_ecriture, description, amount_cents, type, status,
          cw_numero_piece, comptaweb_ecriture_id, cw_signature, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      e.comptaweb_ecriture_id,
      e.cw_signature,
      e.notes,
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
  const r = { id: 'SYNC-2026-000', group_id: 'g1', finished_at: null, ...overrides };
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
  scanDrafts?: SyncCycleOptions['scanDrafts'];
  scrapeDetail?: SyncCycleOptions['scrapeDetail'];
  resolveActiviteId?: SyncCycleOptions['resolveActiviteId'];
  resolveUniteId?: SyncCycleOptions['resolveUniteId'];
  resolveCategoryId?: SyncCycleOptions['resolveCategoryId'];
  now?: () => number;
  trigger?: SyncCycleOptions['trigger'];
  force?: boolean;
  scope?: SyncCycleOptions['scope'];
  failScrape?: boolean;
}): SyncCycleOptions {
  return {
    trigger: opts.trigger ?? 'client',
    force: opts.force,
    scope: opts.scope,
    now: opts.now,
    loadConfig: async () => FAKE_CONFIG,
    scrapeListe: async (): Promise<ScrapeListeEcrituresResult> => {
      if (opts.failScrape) throw new Error('CW down');
      return { ecritures: opts.ecritures ?? [] };
    },
    scanDrafts: opts.scanDrafts ?? (async () => ({ crees: 0, existants: 0 })),
    // Détail par défaut : mono-ventilation = le montant total de la ligne CW
    // (cas courant). Les tests multi-ventilation injectent leur propre scrapeDetail.
    scrapeDetail:
      opts.scrapeDetail ??
      (async (cwId: number) => {
        const row = (opts.ecritures ?? []).find((e) => e.id === cwId);
        return {
          ventilations: row
            ? [{ montantCents: row.montantCentimes, nature: null, activite: null, brancheprojet: null }]
            : [],
        };
      }),
    resolveActiviteId: opts.resolveActiviteId ?? (async () => null),
    resolveUniteId: opts.resolveUniteId ?? (async () => null),
    resolveCategoryId: opts.resolveCategoryId ?? (async () => null),
  };
}

async function getEcriture(db: DbWrapper, id: string) {
  return db
    .prepare(
      'SELECT status, cw_numero_piece, comptaweb_ecriture_id, amount_cents, description, notes FROM ecritures WHERE id = ?',
    )
    .get<{
      status: string;
      cw_numero_piece: string | null;
      comptaweb_ecriture_id: number | null;
      amount_cents: number;
      description: string;
      notes: string | null;
    }>(id);
}

// ============================================================
// Régression : throttle + verrou (inchangé vs ADR-032)
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
    await insertSyncRun(db, { id: 'SYNC-2026-001', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:30Z', status: 'ok' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('skipped');
    expect(res.skipped_reason).toBe('throttled');
  });

  it('force=true bypass le throttle', async () => {
    const now = new Date('2026-05-19T12:10:00Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-2026-001', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:30Z', status: 'ok' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now, force: true }));
    expect(res.status).toBe('ok');
  });

  it('skip si un run est en cours depuis < 60s', async () => {
    const now = new Date('2026-05-19T12:00:30Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-2026-001', started_at: '2026-05-19T12:00:00Z', status: 'running' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('skipped');
    expect(res.skipped_reason).toBe('already_running');
  });

  it('force ne bypass PAS le verrou running (sécurité)', async () => {
    const now = new Date('2026-05-19T12:00:30Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-2026-001', started_at: '2026-05-19T12:00:00Z', status: 'running' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now, force: true }));
    expect(res.status).toBe('skipped');
    expect(res.skipped_reason).toBe('already_running');
  });

  it('considère un running > 60s comme zombie et lance quand même', async () => {
    const now = new Date('2026-05-19T12:02:00Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-2026-001', started_at: '2026-05-19T12:00:00Z', status: 'running' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('ok');
  });

  it('un last_run failed ne fait pas throttle (on retente)', async () => {
    const now = new Date('2026-05-19T12:05:00Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-2026-001', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:10Z', status: 'failed' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('ok');
  });
});

// ============================================================
// Réconciliation : updates (CW écrase)
// ============================================================

describe('runSyncCycle — update mirror (CW écrase)', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('promeut un pending_sync matché par clé stable et écrase ses champs', async () => {
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'pending_sync', comptaweb_ecriture_id: 2386515, amount_cents: 49100, type: 'depense', notes: 'note perso' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101', montantCentimes: 49100, intitule: 'Don WET' })],
    }));
    expect(res.status).toBe('ok');
    expect(res.updated_mirror).toBe(1);
    const ecr = await getEcriture(db, 'ECR-2026-001');
    expect(ecr?.status).toBe('mirror');
    expect(ecr?.cw_numero_piece).toBe('ECR-2026-101');
    expect(ecr?.description).toBe('Don WET'); // CW écrase l'intitulé
    expect(ecr?.notes).toBe('note perso'); // enrichissement local préservé
  });

  it('CW écrase le montant divergent (plus de statut divergent)', async () => {
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'pending_sync', comptaweb_ecriture_id: 2386515, amount_cents: 49100 });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 2386515, montantCentimes: 50000 })],
    }));
    expect(res.divergent_detected).toBe(0);
    const ecr = await getEcriture(db, 'ECR-2026-001');
    expect(ecr?.status).toBe('mirror');
    expect(ecr?.amount_cents).toBe(50000); // aligné sur CW
  });

  it('heal : matche un mirror legacy par cw_numero_piece texte (comptaweb_ecriture_id NULL)', async () => {
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'mirror', cw_numero_piece: 'ECR-2026-101', comptaweb_ecriture_id: null, amount_cents: 49100 });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101', montantCentimes: 49100 })],
    }));
    expect(res.updated_mirror).toBe(1);
    const ecr = await getEcriture(db, 'ECR-2026-001');
    expect(ecr?.comptaweb_ecriture_id).toBe(2386515); // healé
  });

  it("ne relit PAS le détail si la signature n'a pas changé (incrémental)", async () => {
    // Pré-calcul de la signature pour la stocker telle qu'elle sera recalculée.
    const { computeCwSignature } = await import('../ecritures-sync-reconcile');
    const sig = computeCwSignature({ date: '2026-05-04', type: 'depense', montantCents: 49100, intitule: 'Test', numeroPiece: 'ECR-2026-101', modeTransaction: 'Virement', categorieTiers: '' });
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'mirror', comptaweb_ecriture_id: 2386515, cw_signature: sig });
    // Imputation déjà présente → pas de raison de relire le détail.
    await db.prepare("UPDATE ecritures SET activite_id = 'ACT-X' WHERE id = 'ECR-2026-001'").run();
    let detailCalls = 0;
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 2386515, numeroPiece: 'ECR-2026-101' })],
      scrapeDetail: async () => { detailCalls++; return { ventilations: [] }; },
    }));
    expect(detailCalls).toBe(0);
    expect(res.detail_fetches).toBe(0);
    // Rien à enrichir (signature inchangée + imputation présente) → pas de traitement.
    expect(res.updated_mirror).toBe(0);
  });

  it('relit le détail et résout activité/unité/catégorie quand la signature a changé', async () => {
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'mirror', comptaweb_ecriture_id: 2386515, cw_signature: 'OLD' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 2386515 })],
      scrapeDetail: async () => ({ ventilations: [{ montantCents: 49100, nature: 'Dons', activite: 'Camp 2026', brancheprojet: 'Louveteaux' }] }),
      resolveActiviteId: async () => 'ACT-1',
      resolveUniteId: async () => 'UNITE-1',
      resolveCategoryId: async () => 'CAT-1',
    }));
    expect(res.detail_fetches).toBe(1);
    const ecr = await db.prepare('SELECT activite_id, unite_id, category_id, comptaweb_synced FROM ecritures WHERE id = ?').get<{ activite_id: string; unite_id: string; category_id: string; comptaweb_synced: number }>('ECR-2026-001');
    expect(ecr?.activite_id).toBe('ACT-1');
    expect(ecr?.unite_id).toBe('UNITE-1');
    expect(ecr?.category_id).toBe('CAT-1');
    expect(ecr?.comptaweb_synced).toBe(1); // flag synced posé (badge "Synchro CW")
  });
});

// ============================================================
// Réconciliation : suppressions
// ============================================================

describe('runSyncCycle — suppressions', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('passe en supprimee_cw une écriture reliée absente dans la plage couverte', async () => {
    await insertEcriture(db, { id: 'ECR-DEL', status: 'mirror', comptaweb_ecriture_id: 150 });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 100 }), makeRow({ id: 200, numeroPiece: 'ECR-2026-200' })],
    }));
    expect(res.supprimee_cw_detected).toBe(1);
    const ecr = await getEcriture(db, 'ECR-DEL');
    expect(ecr?.status).toBe('supprimee_cw');
  });

  it("ne supprime pas une écriture reliée hors plage (id < min)", async () => {
    await insertEcriture(db, { id: 'ECR-OLD', status: 'mirror', comptaweb_ecriture_id: 50 });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 100 }), makeRow({ id: 200, numeroPiece: 'ECR-2026-200' })],
    }));
    expect(res.supprimee_cw_detected).toBe(0);
    const ecr = await getEcriture(db, 'ECR-OLD');
    expect(ecr?.status).toBe('mirror');
  });
});

// ============================================================
// Réconciliation : imports + drafts + suggestions
// ============================================================

describe('runSyncCycle — imports et drafts', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('importe une ligne CW sans équivalent Baloo (création mirror)', async () => {
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 777, numeroPiece: 'ECR-2026-777', intitule: 'Saisie CW directe', montantCentimes: 1234 })],
    }));
    expect(res.imported_from_cw).toBe(1);
    const row = await db.prepare("SELECT id, status, amount_cents FROM ecritures WHERE comptaweb_ecriture_id = 777").get<{ id: string; status: string; amount_cents: number }>();
    expect(row?.status).toBe('mirror');
    expect(row?.amount_cents).toBe(1234);
  });

  it('promeut un draft sur match contenu unique', async () => {
    await insertEcriture(db, { id: 'DRAFT-1', status: 'draft', cw_numero_piece: null, comptaweb_ecriture_id: null, amount_cents: 4200, type: 'depense', date_ecriture: '2026-05-04' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 900, numeroPiece: 'ECR-2026-900', montantCentimes: 4200, type: 'depense', dateEcriture: '2026-05-05' })],
    }));
    expect(res.promoted_to_mirror).toBe(1);
    expect(res.imported_from_cw).toBe(0); // ligne consommée, pas réimportée
    const ecr = await getEcriture(db, 'DRAFT-1');
    expect(ecr?.status).toBe('mirror');
    expect(ecr?.comptaweb_ecriture_id).toBe(900);
  });

  it('crée des suggestions (sans promotion ni import) sur match ambigu', async () => {
    await insertEcriture(db, { id: 'DRAFT-1', status: 'draft', amount_cents: 2400, type: 'depense', date_ecriture: '2026-05-04' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [
        makeRow({ id: 901, numeroPiece: 'ECR-2026-901', montantCentimes: 2400, dateEcriture: '2026-05-04' }),
        makeRow({ id: 902, numeroPiece: 'ECR-2026-902', montantCentimes: 2400, dateEcriture: '2026-05-04' }),
      ],
    }));
    expect(res.promoted_to_mirror).toBe(0);
    expect(res.link_suggestions_created).toBe(2);
    expect(res.imported_from_cw).toBe(0);
    const ecr = await getEcriture(db, 'DRAFT-1');
    expect(ecr?.status).toBe('draft'); // inchangé
    const sugg = await db.prepare("SELECT COUNT(*) as c FROM cw_link_suggestions WHERE group_id='g1' AND status='a_confirmer'").get<{ c: number }>();
    expect(sugg?.c).toBe(2);
  });

  it('compte les nouveaux drafts retournés par scanDrafts', async () => {
    const res = await runSyncCycle(db, 'g1', mockOpts({ scanDrafts: async () => ({ crees: 3, existants: 5 }) }));
    expect(res.new_drafts).toBe(3);
  });

  it('scénario combiné : update + delete + import + promotion', async () => {
    await insertEcriture(db, { id: 'UPD', status: 'mirror', comptaweb_ecriture_id: 100, cw_signature: 'OLD' });
    await insertEcriture(db, { id: 'DEL', status: 'mirror', comptaweb_ecriture_id: 150 });
    await insertEcriture(db, { id: 'DRAFT', status: 'draft', amount_cents: 5000, type: 'depense', date_ecriture: '2026-05-01' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [
        makeRow({ id: 100, numeroPiece: 'ECR-100' }),
        makeRow({ id: 200, numeroPiece: 'ECR-200' }),
        makeRow({ id: 250, numeroPiece: 'ECR-250', montantCentimes: 5000, dateEcriture: '2026-05-01' }),
        makeRow({ id: 260, numeroPiece: 'ECR-260', montantCentimes: 9999, dateEcriture: '2026-05-05' }),
      ],
    }));
    // UPD (cwId 100) + le draft promu (cwId 250) sont tous deux réécrits au
    // grain ventilation → 2 ventilations mises à jour.
    expect(res.updated_mirror).toBe(2);
    expect(res.supprimee_cw_detected).toBe(1);
    expect(res.promoted_to_mirror).toBe(1);
    expect(res.imported_from_cw).toBe(2); // 200 et 260
  });

  it('multi-ventilation : 491 CW (481+10) absorbe 2 écritures CSV, pas d’agrégat', async () => {
    // 2 écritures « CSV » non reliées (grain ventilation), à la même date/type.
    await insertEcriture(db, { id: 'CSV-481', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 48100, type: 'depense', date_ecriture: '2026-05-04' });
    await insertEcriture(db, { id: 'CSV-10', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 1000, type: 'depense', date_ecriture: '2026-05-04' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 555, numeroPiece: '', montantCentimes: 49100, type: 'depense', dateEcriture: '2026-05-04', intitule: 'Regroupement' })],
      scrapeDetail: async () => ({ ventilations: [
        { montantCents: 48100, nature: 'Formation', activite: 'Formation', brancheprojet: 'Louveteaux-Jeannettes' },
        { montantCents: 1000, nature: 'Cotisations SGDF', activite: 'Fonctionnement', brancheprojet: 'Pionniers-Caravelles' },
      ] }),
      resolveCategoryId: async (n) => (n === 'Formation' ? 'CAT-FORM' : 'CAT-COTIS'),
    }));
    expect(res.updated_mirror).toBe(2); // les 2 CSV reliées
    expect(res.imported_from_cw).toBe(0); // rien créé : les CSV ont absorbé
    // les 2 écritures sont reliées au cwId, montants préservés, catégories posées
    const e481 = await getEcriture(db, 'CSV-481');
    const e10 = await getEcriture(db, 'CSV-10');
    expect(e481?.comptaweb_ecriture_id).toBe(555);
    expect(e10?.comptaweb_ecriture_id).toBe(555);
    expect(e481?.amount_cents).toBe(48100);
    expect(e10?.amount_cents).toBe(1000);
    // pas d'agrégat 49100 créé
    const agg = await db.prepare("SELECT COUNT(*) as c FROM ecritures WHERE group_id='g1' AND amount_cents=49100").get<{ c: number }>();
    expect(agg?.c).toBe(0);
  });

  it('un agrégat relié non apparié passe en agrege_remplace (pas supprimee_cw)', async () => {
    // Agrégat (total 49100) déjà relié au cwId 555 + 2 ventilations CSV.
    await insertEcriture(db, { id: 'AGG', status: 'mirror', comptaweb_ecriture_id: 555, amount_cents: 49100, type: 'depense', date_ecriture: '2026-05-04' });
    await insertEcriture(db, { id: 'CSV-481', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 48100, type: 'depense', date_ecriture: '2026-05-04' });
    await insertEcriture(db, { id: 'CSV-10', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 1000, type: 'depense', date_ecriture: '2026-05-04' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 555, numeroPiece: '', montantCentimes: 49100, type: 'depense', dateEcriture: '2026-05-04' })],
      scrapeDetail: async () => ({ ventilations: [
        { montantCents: 48100, nature: 'Formation', activite: 'Formation', brancheprojet: 'Louveteaux-Jeannettes' },
        { montantCents: 1000, nature: 'Cotisations SGDF', activite: 'Fonctionnement', brancheprojet: 'Pionniers-Caravelles' },
      ] }),
    }));
    expect(res.supprimee_cw_detected).toBe(1); // l'agrégat orphelin
    const agg = await db.prepare("SELECT status FROM ecritures WHERE id='AGG'").get<{ status: string }>();
    expect(agg?.status).toBe('agrege_remplace'); // PAS supprimee_cw
  });

  it('résorbe un agrégat legacy DÉJÀ imputé+synced grâce aux ventilations détachées', async () => {
    // L'agrégat a une imputation ET une signature à jour → needsDetail faux.
    // Sans la détection des ventilations détachées, il ne serait jamais traité.
    const { computeCwSignature } = await import('../ecritures-sync-reconcile');
    const sig = computeCwSignature({ date: '2026-05-04', type: 'depense', montantCents: 49100, intitule: 'Regroupement', numeroPiece: '', modeTransaction: 'Virement', categorieTiers: '' });
    await insertEcriture(db, { id: 'AGG', status: 'mirror', comptaweb_ecriture_id: 555, amount_cents: 49100, type: 'depense', date_ecriture: '2026-05-04', description: 'Regroupement', cw_signature: sig });
    await db.prepare("UPDATE ecritures SET activite_id='ACT-X', unite_id='U-LJ' WHERE id='AGG'").run(); // imputé
    await insertEcriture(db, { id: 'CSV-481', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 48100, type: 'depense', date_ecriture: '2026-05-04', description: 'Regroupement' });
    await insertEcriture(db, { id: 'CSV-10', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 1000, type: 'depense', date_ecriture: '2026-05-04', description: 'Regroupement' });
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 555, numeroPiece: '', montantCentimes: 49100, type: 'depense', dateEcriture: '2026-05-04', intitule: 'Regroupement' })],
      scrapeDetail: async () => ({ ventilations: [
        { montantCents: 48100, nature: 'Formation', activite: 'Formation', brancheprojet: 'Louveteaux-Jeannettes' },
        { montantCents: 1000, nature: 'Cotisations SGDF', activite: 'Fonctionnement', brancheprojet: 'Pionniers-Caravelles' },
      ] }),
    }));
    const agg = await db.prepare("SELECT status FROM ecritures WHERE id='AGG'").get<{ status: string }>();
    expect(agg?.status).toBe('agrege_remplace'); // résorbé malgré imputation+signature OK
    // les 2 CSV reliées au cwId
    const linked = await db.prepare("SELECT COUNT(*) c FROM ecritures WHERE comptaweb_ecriture_id=555 AND id LIKE 'CSV-%'").get<{ c: number }>();
    expect(linked?.c).toBe(2);
  });

  it('doublon (copie CSV avec justif + jumelle sync nue) → garde la copie au justif, neutralise la nue', async () => {
    // Cas réel "Courte échelle" : une écriture CSV non reliée PORTE le justif,
    // une jumelle créée par une ancienne sync est reliée mais nue. On garde
    // l'enrichie (reliée au cwId) et on passe la nue en agrege_remplace.
    await insertEcriture(db, { id: 'SYNC-DUP', status: 'mirror', comptaweb_ecriture_id: 700, amount_cents: 25000, type: 'depense', date_ecriture: '2026-05-04', description: 'Courte échelle' });
    await insertEcriture(db, { id: 'CSV-DUP', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 25000, type: 'depense', date_ecriture: '2026-05-04', description: 'Courte échelle' });
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1','ecriture','CSV-DUP')").run();
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 700, numeroPiece: '', montantCentimes: 25000, type: 'depense', dateEcriture: '2026-05-04', intitule: 'Courte échelle' })],
      scrapeDetail: async () => ({ ventilations: [
        { montantCents: 25000, nature: 'Hébergement', activite: 'Activités', brancheprojet: 'Groupe' },
      ] }),
    }));
    expect(res.supprimee_cw_detected).toBe(1); // la jumelle nue
    const csv = await db.prepare("SELECT status, comptaweb_ecriture_id FROM ecritures WHERE id='CSV-DUP'").get<{ status: string; comptaweb_ecriture_id: number | null }>();
    expect(csv?.status).toBe('mirror'); // la copie au justif est gardée…
    expect(csv?.comptaweb_ecriture_id).toBe(700); // …et reliée au cwId
    const sync = await db.prepare("SELECT status FROM ecritures WHERE id='SYNC-DUP'").get<{ status: string }>();
    expect(sync?.status).toBe('agrege_remplace'); // la jumelle nue est neutralisée
    // le justif n'a pas bougé (toujours sur la copie gardée)
    const just = await db.prepare("SELECT entity_id FROM justificatifs WHERE id='J1'").get<{ entity_id: string }>();
    expect(just?.entity_id).toBe('CSV-DUP');
  });

  it('doublon dont les DEUX copies portent une pièce → ne neutralise pas (rien perdu)', async () => {
    await insertEcriture(db, { id: 'DUP-A', status: 'mirror', comptaweb_ecriture_id: 701, amount_cents: 25000, type: 'depense', date_ecriture: '2026-05-04', description: 'X' });
    await insertEcriture(db, { id: 'DUP-B', status: 'mirror', comptaweb_ecriture_id: null, amount_cents: 25000, type: 'depense', date_ecriture: '2026-05-04', description: 'X' });
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('JA','ecriture','DUP-A')").run();
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('JB','ecriture','DUP-B')").run();
    const res = await runSyncCycle(db, 'g1', mockOpts({
      ecritures: [makeRow({ id: 701, numeroPiece: '', montantCentimes: 25000, type: 'depense', dateEcriture: '2026-05-04', intitule: 'X' })],
      scrapeDetail: async () => ({ ventilations: [
        { montantCents: 25000, nature: 'Hébergement', activite: 'Activités', brancheprojet: 'Groupe' },
      ] }),
    }));
    expect(res.supprimee_cw_detected).toBe(0); // aucune neutralisation (les deux ont une pièce)
    const neutralised = await db.prepare("SELECT COUNT(*) c FROM ecritures WHERE status='agrege_remplace'").get<{ c: number }>();
    expect(neutralised?.c).toBe(0);
  });
});

// ============================================================
// scope + erreurs + stale
// ============================================================

describe('runSyncCycle — scope, stale et erreurs', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('persiste le scope dans sync_runs', async () => {
    const res = await runSyncCycle(db, 'g1', mockOpts({ scope: 'exercice' }));
    expect(res.scope).toBe('exercice');
    const row = await db.prepare('SELECT scope FROM sync_runs WHERE id = ?').get<{ scope: string }>(res.sync_run_id);
    expect(row?.scope).toBe('exercice');
  });

  it('warning si pending_sync stale > 1h (status reste ok)', async () => {
    const now = new Date('2026-05-19T14:00:00Z').getTime();
    await insertEcriture(db, { id: 'ECR-2026-001', status: 'pending_sync', comptaweb_ecriture_id: 9999999, updated_at: '2026-05-19T12:30:00Z' });
    const res = await runSyncCycle(db, 'g1', mockOpts({ now: () => now }));
    expect(res.status).toBe('ok');
    expect(res.error_message).toMatch(/1 pending_sync stales > 1h/);
  });

  it('scraper throws → status failed + error_message renseigné', async () => {
    const res = await runSyncCycle(db, 'g1', mockOpts({ failScrape: true }));
    expect(res.status).toBe('failed');
    expect(res.error_message).toMatch(/CW down/);
    const row = await db.prepare('SELECT status FROM sync_runs WHERE id = ?').get<{ status: string }>(res.sync_run_id);
    expect(row?.status).toBe('failed');
  });
});

// ============================================================
// Isolation multi-groupes
// ============================================================

describe('runSyncCycle — isolation multi-groupes', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  it('sync groupe A ne touche pas les écritures du groupe B', async () => {
    await insertEcriture(db, { id: 'ECR-A1', group_id: 'g_a', comptaweb_ecriture_id: 111, amount_cents: 1000 });
    await insertEcriture(db, { id: 'ECR-B1', group_id: 'g_b', comptaweb_ecriture_id: 111, amount_cents: 1000 });
    await runSyncCycle(db, 'g_a', mockOpts({ ecritures: [makeRow({ id: 111, montantCentimes: 1000 })] }));
    const a = await getEcriture(db, 'ECR-A1');
    const b = await getEcriture(db, 'ECR-B1');
    expect(a?.status).toBe('mirror');
    expect(b?.status).toBe('pending_sync'); // intact
  });

  it('throttle par groupe : last_run g_a ne throttle pas g_b', async () => {
    const now = new Date('2026-05-19T12:05:00Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-1', group_id: 'g_a', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:30Z', status: 'ok' });
    const resA = await runSyncCycle(db, 'g_a', mockOpts({ now: () => now }));
    const resB = await runSyncCycle(db, 'g_b', mockOpts({ now: () => now }));
    expect(resA.status).toBe('skipped');
    expect(resB.status).toBe('ok');
  });
});

// ============================================================
// resyncEcritureDetail — resync ciblé
// ============================================================

describe('resyncEcritureDetail', () => {
  let db: DbWrapper;
  beforeEach(async () => { ({ db } = await setupDb()); });

  const inj = {
    loadConfig: async () => FAKE_CONFIG,
    // insertEcriture pose amount_cents=49100 par défaut → la ventilation doit
    // avoir le même montant pour s'apparier à l'écriture candidate.
    scrapeDetail: async () => ({ ventilations: [{ montantCents: 49100, nature: 'Flux', activite: 'WET', brancheprojet: 'Groupe' }] }),
    resolveActiviteId: async () => 'ACT-WET',
    resolveUniteId: async () => 'UNITE-GR',
    resolveCategoryId: async () => 'CAT-FLUX',
  };

  it('réaligne imputation + comptaweb_synced sur une écriture reliée', async () => {
    await insertEcriture(db, { id: 'ECR-2026-224', status: 'mirror', comptaweb_ecriture_id: 2390826 });
    const res = await resyncEcritureDetail(db, 'g1', 'ECR-2026-224', inj);
    expect(res.ok).toBe(true);
    const ecr = await db.prepare('SELECT activite_id, unite_id, category_id, comptaweb_synced, status FROM ecritures WHERE id = ?').get<{ activite_id: string; unite_id: string; category_id: string; comptaweb_synced: number; status: string }>('ECR-2026-224');
    expect(ecr).toEqual({ activite_id: 'ACT-WET', unite_id: 'UNITE-GR', category_id: 'CAT-FLUX', comptaweb_synced: 1, status: 'mirror' });
  });

  it('résilience : un resolver qui throw n’efface pas les autres imputations', async () => {
    await insertEcriture(db, { id: 'ECR-2026-224', status: 'mirror', comptaweb_ecriture_id: 2390826 });
    const res = await resyncEcritureDetail(db, 'g1', 'ECR-2026-224', {
      ...inj,
      // simule l'ancien bug categories.group_id (LibsqlError)
      resolveCategoryId: async () => { throw new Error('no such column: group_id'); },
    });
    expect(res.ok).toBe(true);
    const ecr = await db.prepare('SELECT activite_id, unite_id, category_id FROM ecritures WHERE id = ?').get<{ activite_id: string; unite_id: string; category_id: string | null }>('ECR-2026-224');
    expect(ecr?.activite_id).toBe('ACT-WET'); // préservé malgré l'échec catégorie
    expect(ecr?.unite_id).toBe('UNITE-GR');
    expect(ecr?.category_id ?? null).toBeNull();
  });

  it('refuse une écriture non reliée (pas d’id CW)', async () => {
    await insertEcriture(db, { id: 'D1', status: 'draft', comptaweb_ecriture_id: null });
    const res = await resyncEcritureDetail(db, 'g1', 'D1', inj);
    expect(res).toEqual({ ok: false, reason: 'not_linked' });
  });

  it('introuvable → not_found', async () => {
    const res = await resyncEcritureDetail(db, 'g1', 'NOPE', inj);
    expect(res).toEqual({ ok: false, reason: 'not_found' });
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
    await insertSyncRun(db, { id: 'SYNC-1', started_at: '2026-05-19T12:00:00Z', status: 'running' });
    const s = await getSyncStatus(db, 'g1', { now: () => now });
    expect(s.is_running).toBe(true);
  });

  it('renvoie stale=false et throttle_until pour un run ok récent', async () => {
    const now = new Date('2026-05-19T12:10:00Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-1', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:30Z', status: 'ok' });
    const s = await getSyncStatus(db, 'g1', { now: () => now });
    expect(s.stale).toBe(false);
    expect(s.throttle_until).toBe('2026-05-19T12:15:30.000Z');
  });

  it('renvoie stale=true si > 15 min depuis last_ok', async () => {
    const now = new Date('2026-05-19T12:30:00Z').getTime();
    await insertSyncRun(db, { id: 'SYNC-1', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:30Z', status: 'ok' });
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
    await insertSyncRun(db, { id: 'SYNC-1', started_at: '2026-05-19T12:00:00Z', finished_at: '2026-05-19T12:00:30Z', status: 'ok' });
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
    await insertSyncRun(db, { id: 'SYNC-1', started_at: '2026-05-19T12:00:00Z', status: 'running' });
    let scraperCalled = false;
    await ensureSyncFresh(db, 'g1', 'mcp', {
      now: () => now,
      loadConfig: async () => FAKE_CONFIG,
      scrapeListe: async () => { scraperCalled = true; return { ecritures: [] }; },
    });
    expect(scraperCalled).toBe(false);
  });
});
