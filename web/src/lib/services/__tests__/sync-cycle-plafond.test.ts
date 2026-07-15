// Task 3 : plafond K de lectures détail CW par cycle, priorité de la file
// (promotions → imports → updates enrichissement → agrégats legacy), et
// `remaining` (cwId différés au cycle suivant). Anti-timeout Vercel (60 s).
// Cf. .superpowers/sdd/task-3-brief.md.
//
// Réutilise le harnais de `sync-cycle.test.ts` (setupDb, insertEcriture,
// makeRow, mockOpts) plutôt que de le dupliquer intégralement.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import { runSyncCycle, type SyncCycleOptions } from '../sync-cycle';
import type {
  ComptawebConfig,
  CwEcritureRow,
  ScrapeListeEcrituresResult,
} from '../../comptaweb/types';
import type { EcritureDetail } from '../../comptaweb';

// ---------------- Setup BDD (identique à sync-cycle.test.ts) ----------------

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

// ---------------- Mocks scrapers (identique à sync-cycle.test.ts) ----------------

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
    scanDrafts: opts.scanDrafts ?? (async () => ({ crees: 0, existants: 0, supprimes: 0 })),
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
  // `nature` renseigné (résolu en category_id ci-dessous) pour que
  // `hasImputation` devienne vrai après un premier traitement — sans quoi
  // `needsDetail` resterait vrai indéfiniment (imputation jamais posée) et un
  // cwId déjà traité serait re-mis en file au cycle suivant (cf. test B).
  return { ventilations: [{ montantCents: 1000, nature: 'Cat', activite: null, brancheprojet: null }] };
}

describe('runSyncCycle — plafond K détails/cycle + priorité + remaining', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    ({ db } = await setupDb());
  });

  it('plafonne à K scrapeDetail par cycle et renvoie remaining', async () => {
    const ecritures = listeOf(20);
    const calls: number[] = [];
    const scrapeDetail = async (cwId: number) => {
      calls.push(cwId);
      return ventilationsFor(cwId);
    };
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({ ecritures, scrapeDetail, force: true, maxDetailFetches: 12 }),
    );
    expect(calls.length).toBe(12);
    expect(res.remaining).toBe(8);
    expect(res.status).toBe('ok');
  });

  it('draine en deux cycles sans retraiter les écritures déjà enrichies', async () => {
    const ecritures = listeOf(20);
    const calls: number[] = [];
    const scrapeDetail = async (cwId: number) => {
      calls.push(cwId);
      return ventilationsFor(cwId);
    };
    const opts = mockOpts({
      ecritures,
      scrapeDetail,
      force: true,
      maxDetailFetches: 12,
      resolveCategoryId: async () => 'CAT-1',
    });

    const r1 = await runSyncCycle(db, 'g1', opts);
    const r2 = await runSyncCycle(db, 'g1', opts);

    expect(r1.remaining).toBe(8);
    expect(r2.remaining).toBe(0);
    expect(calls.length).toBe(20);
  });

  it('priorise promotions puis imports quand le budget est serré', async () => {
    // 1 draft promouvable (contenu unique) + 1 import + 15 updates à enrichir.
    await insertEcriture(db, {
      id: 'DRAFT-1',
      status: 'draft',
      amount_cents: 4200,
      type: 'depense',
      date_ecriture: '2026-05-04',
    });
    const cwPromo = makeRow({
      id: 900,
      numeroPiece: 'ECR-2026-900',
      montantCentimes: 4200,
      type: 'depense',
      dateEcriture: '2026-05-05', // dans la tolérance de 3 jours
    });
    const cwImport = makeRow({ id: 950, numeroPiece: 'ECR-2026-950', montantCentimes: 777 });

    // 15 écritures déjà reliées mais à enrichir (signature obsolète).
    const updateRows: CwEcritureRow[] = [];
    for (let i = 0; i < 15; i++) {
      const id = 2000 + i;
      updateRows.push(makeRow({ id, numeroPiece: `ECR-2026-${id}`, montantCentimes: 100 + i }));
      await insertEcriture(db, {
        id: `UPD-${id}`,
        status: 'mirror',
        comptaweb_ecriture_id: id,
        amount_cents: 100 + i,
        cw_signature: 'OLD',
      });
    }

    const calls: number[] = [];
    const scrapeDetail = async (cwId: number) => {
      calls.push(cwId);
      return ventilationsFor(cwId);
    };

    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [cwPromo, cwImport, ...updateRows],
        scrapeDetail,
        force: true,
        maxDetailFetches: 2,
      }),
    );

    expect(calls).toEqual([900, 950]);
    expect(res.remaining).toBe(15); // les 15 updates restent à traiter
  });

  it('applique deletions/suggestions en entier malgré la troncature', async () => {
    const ecritures = listeOf(20);
    // 3 deletions : écritures reliées, DANS LA PLAGE [min(cwId), max(cwId)]
    // du snapshot (901 via ambigCw ci-dessous .. 1019 via listeOf), absentes de CW.
    await insertEcriture(db, { id: 'DEL-1', status: 'mirror', comptaweb_ecriture_id: 903 });
    await insertEcriture(db, { id: 'DEL-2', status: 'mirror', comptaweb_ecriture_id: 904 });
    await insertEcriture(db, { id: 'DEL-3', status: 'mirror', comptaweb_ecriture_id: 905 });
    // 2 suggestions : 2 drafts au même montant/date matchant ambigument 2 lignes CW.
    await insertEcriture(db, {
      id: 'AMBIG-1',
      status: 'draft',
      amount_cents: 2400,
      type: 'depense',
      date_ecriture: '2026-05-04',
    });
    await insertEcriture(db, {
      id: 'AMBIG-2',
      status: 'draft',
      amount_cents: 2400,
      type: 'depense',
      date_ecriture: '2026-05-04',
    });
    const ambigCw = [
      makeRow({ id: 901, numeroPiece: 'ECR-2026-901', montantCentimes: 2400, dateEcriture: '2026-05-04' }),
      makeRow({ id: 902, numeroPiece: 'ECR-2026-902', montantCentimes: 2400, dateEcriture: '2026-05-04' }),
    ];

    const scrapeDetail = async (cwId: number) => ventilationsFor(cwId);
    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({
        ecritures: [...ecritures, ...ambigCw],
        scrapeDetail,
        force: true,
        maxDetailFetches: 12,
      }),
    );

    expect(res.supprimee_cw_detected).toBe(3);
    expect(res.link_suggestions_created).toBe(2);
  });

  it('pose la liaison des promotions même au-delà du budget', async () => {
    const drafts: { id: string; cwId: number }[] = [];
    const cwRows: CwEcritureRow[] = [];
    for (let i = 0; i < 15; i++) {
      const cwId = 3000 + i;
      const draftId = `DRAFT-${i}`;
      drafts.push({ id: draftId, cwId });
      await insertEcriture(db, {
        id: draftId,
        status: 'draft',
        amount_cents: 5000 + i,
        type: 'depense',
        date_ecriture: '2026-05-04',
      });
      cwRows.push(
        makeRow({
          id: cwId,
          numeroPiece: `ECR-2026-${cwId}`,
          montantCentimes: 5000 + i,
          type: 'depense',
          dateEcriture: '2026-05-04',
        }),
      );
    }

    const calls: number[] = [];
    const scrapeDetail = async (cwId: number) => {
      calls.push(cwId);
      return ventilationsFor(cwId);
    };

    const res = await runSyncCycle(
      db,
      'g1',
      mockOpts({ ecritures: cwRows, scrapeDetail, force: true, maxDetailFetches: 12 }),
    );

    expect(calls.length).toBe(12);
    expect(res.remaining).toBe(3);

    for (const d of drafts) {
      const row = await db
        .prepare('SELECT status, comptaweb_ecriture_id FROM ecritures WHERE id = ?')
        .get<{ status: string; comptaweb_ecriture_id: number | null }>(d.id);
      expect(row?.status).toBe('mirror');
      expect(row?.comptaweb_ecriture_id).toBe(d.cwId);
    }
  });
});
