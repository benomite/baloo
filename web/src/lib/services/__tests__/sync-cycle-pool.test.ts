// Task 4 : pool parallèle (concurrence 4) de fetch détail CW en phase 1,
// application séquentielle (writes BDD) en phase 2. Cf. .superpowers/sdd/task-4-brief.md.
//
// Réutilise le harnais de sync-cycle.test.ts / sync-cycle-plafond.test.ts
// (setupDb, makeRow, mockOpts) plutôt que de le dupliquer intégralement.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import { runSyncCycle, type SyncCycleOptions } from '../sync-cycle';
import type { ComptawebConfig, CwEcritureRow, ScrapeListeEcrituresResult } from '../../comptaweb/types';
import type { EcritureDetail } from '../../comptaweb';

// ---------------- Setup BDD (identique à sync-cycle-plafond.test.ts) ----------------

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
  await ensureReconcileSchema(db);
  return { client, db };
}

// ---------------- Mocks scrapers (identique à sync-cycle-plafond.test.ts) ----------------

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
  scrapeDetail?: SyncCycleOptions['scrapeDetail'];
  resolveActiviteId?: SyncCycleOptions['resolveActiviteId'];
  resolveUniteId?: SyncCycleOptions['resolveUniteId'];
  resolveCategoryId?: SyncCycleOptions['resolveCategoryId'];
  now?: () => number;
  trigger?: SyncCycleOptions['trigger'];
  force?: boolean;
  scope?: SyncCycleOptions['scope'];
  maxDetailFetches?: number;
}): SyncCycleOptions {
  return {
    trigger: opts.trigger ?? 'client',
    force: opts.force,
    scope: opts.scope,
    now: opts.now,
    maxDetailFetches: opts.maxDetailFetches,
    loadConfig: async () => FAKE_CONFIG,
    scrapeListe: async (): Promise<ScrapeListeEcrituresResult> => ({
      ecritures: opts.ecritures ?? [],
    }),
    scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
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

/** N lignes CW « à importer » (aucune écriture Baloo ne les référence). */
function listeOf(n: number, startId = 1000): CwEcritureRow[] {
  const rows: CwEcritureRow[] = [];
  for (let i = 0; i < n; i++) {
    const id = startId + i;
    rows.push(
      makeRow({
        id,
        numeroPiece: `ECR-2026-${id}`,
        montantCentimes: 1000 + i,
        intitule: `Import ${id}`,
      }),
    );
  }
  return rows;
}

function ventilationsFor(cwId: number): EcritureDetail {
  return { ventilations: [{ montantCents: 1000, nature: 'Cat', activite: null, brancheprojet: null }] };
}

/** Laisse la boucle micro/macro-tâches avancer (yield réel, pas de fake timers). */
function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('runSyncCycle — pool parallèle (concurrence 4) de fetch détail', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    ({ db } = await setupDb());
  });

  it('exécute les scrapeDetail avec au plus 4 en vol (12 écritures à enrichir)', async () => {
    const ecritures = listeOf(12);
    let inFlight = 0;
    let peak = 0;
    const scrapeDetail = async (cwId: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return ventilationsFor(cwId);
    };

    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({ ecritures, scrapeDetail, force: true, maxDetailFetches: 12 }),
    );

    expect(peak).toBeLessThanOrEqual(4);
    // Preuve de parallélisme réel (pas juste "≤4" trivialement vrai en séquentiel) :
    // avec 12 items et un pool de 4, le pic doit dépasser 1.
    expect(peak).toBeGreaterThan(1);
    expect(res.detail_fetches).toBe(12);
    expect(res.status).toBe('ok');
  });

  it('applique les autres écritures malgré un fetch en échec', async () => {
    const FAILING_CW = 1002;
    const ecritures = listeOf(5); // ids 1000..1004
    const scrapeDetail = async (cwId: number) => {
      if (cwId === FAILING_CW) throw new Error('CW 500');
      return ventilationsFor(cwId);
    };

    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({ ecritures, scrapeDetail, force: true, maxDetailFetches: 12 }),
    );

    expect(res.status).toBe('ok');
    // Les 4 autres écritures (hors FAILING_CW) sont bien importées.
    expect(res.imported_from_cw).toBe(4);

    const failed = await db
      .prepare(`SELECT id FROM ecritures WHERE comptaweb_ecriture_id = ?`)
      .get<{ id: string }>(FAILING_CW);
    expect(failed).toBeUndefined();
  });
});
