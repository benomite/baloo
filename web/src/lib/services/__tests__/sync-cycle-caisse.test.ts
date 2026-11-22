// #61 : le pas caisse de sync_run — solde Comptaweb consigné dans sync_runs,
// échec caisse isolé du cycle banque, session du premier exercice abouti.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import { runSyncCycle, type SyncCycleOptions } from '../sync-cycle';
import type { ComptawebConfig } from '../../comptaweb/types';
import type { CaisseSyncResult } from '../caisse-sync';

const DDL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, unite_id TEXT,
    date_ecriture TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL, category_id TEXT, mode_paiement_id TEXT, activite_id TEXT, carte_id TEXT,
    numero_piece TEXT, cw_numero_piece TEXT, status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1, comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER, ligne_bancaire_sous_index INTEGER, comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, obsolete_at TEXT);
  CREATE TABLE depots_justificatifs (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE depots_especes (id TEXT PRIMARY KEY, ecriture_id TEXT);
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, ecriture_id TEXT);
`;

const RESULTAT_CAISSE: CaisseSyncResult = {
  caisseId: 1,
  libelle: 'Caisse principale',
  soldeComptaweb: 4321,
  soldeBaloo: 4000,
  stats: { pulled: 2, inserted: 1, matched_by_cw_id: 1, matched_by_fallback: 0, unchanged: 0 },
};

function opts(over: Partial<SyncCycleOptions> = {}): SyncCycleOptions {
  return {
    trigger: 'mcp',
    force: true,
    loadConfig: async () => ({ baseUrl: 'https://cw.test', cookie: 'session-banque' }),
    scrapeListe: async () => ({ ecritures: [] }),
    scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
    scrapeDetail: async () => ({ ventilations: [] }),
    resolveActiviteId: async () => null,
    resolveUniteId: async () => null,
    resolveCategoryId: async () => null,
    ...over,
  };
}

async function runRow(db: DbWrapper, id: string) {
  return await db
    .prepare('SELECT status, caisse_solde_cw_cents, caisse_error, error_message FROM sync_runs WHERE id = ?')
    .get<{ status: string; caisse_solde_cw_cents: number | null; caisse_error: string | null; error_message: string | null }>(id);
}

describe('sync_run — pas caisse (#61)', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    db = wrapClient(client);
    await db.exec(DDL);
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
  });

  it('synchronise la caisse dans la session du cycle et consigne le solde Comptaweb', async () => {
    const vues: ComptawebConfig[] = [];
    const res = await runSyncCycle(
      db,
      'g1',
      opts({
        syncCaisse: async (groupId, cfg) => {
          expect(groupId).toBe('g1');
          vues.push(cfg);
          return RESULTAT_CAISSE;
        },
      }),
    );
    expect(res.status).toBe('ok');
    expect(vues).toEqual([{ baseUrl: 'https://cw.test', cookie: 'session-banque' }]);
    expect(res.caisse).toEqual({
      status: 'ok',
      solde_comptaweb_cents: 4321,
      solde_baloo_cents: 4000,
      stats: RESULTAT_CAISSE.stats,
    });
    expect(await runRow(db, res.sync_run_id)).toEqual({
      status: 'ok',
      caisse_solde_cw_cents: 4321,
      caisse_error: null,
      error_message: null,
    });
  });

  it("un échec caisse n'emporte pas le cycle banque : consigné à part", async () => {
    const res = await runSyncCycle(
      db,
      'g1',
      opts({
        syncCaisse: async () => {
          throw new Error('caisse introuvable');
        },
      }),
    );
    expect(res.status).toBe('ok');
    expect(res.caisse).toEqual({ status: 'failed', error_message: 'caisse introuvable' });
    expect(await runRow(db, res.sync_run_id)).toMatchObject({
      status: 'ok',
      caisse_solde_cw_cents: null,
      caisse_error: 'caisse introuvable',
    });
  });

  it('prend la session du premier exercice abouti, une seule fois', async () => {
    const vues: string[] = [];
    const res = await runSyncCycle(
      db,
      'g1',
      opts({
        loadConfig: undefined,
        exercices: [
          { code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' },
          { code: '2025-2026', cwId: 33, debut: '2025-09-01', fin: '2026-08-31' },
          { code: '2024-2025', cwId: 32, debut: '2024-09-01', fin: '2025-08-31' },
        ],
        loadConfigPourExercice: async (cwId) => {
          if (cwId === 34) throw new Error('bascule refusée');
          return { baseUrl: 'https://cw.test', cookie: `c-${cwId}` };
        },
        syncCaisse: async (_g, cfg) => {
          vues.push(cfg.cookie);
          return RESULTAT_CAISSE;
        },
      }),
    );
    expect(res.status).toBe('ok');
    expect(vues).toEqual(['c-33']);
  });

  it('un tour dont le scrape échoue ne prête pas sa session à la caisse', async () => {
    const vues: string[] = [];
    await runSyncCycle(
      db,
      'g1',
      opts({
        loadConfig: undefined,
        exercices: [
          { code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' },
          { code: '2025-2026', cwId: 33, debut: '2025-09-01', fin: '2026-08-31' },
        ],
        loadConfigPourExercice: async (cwId) => ({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
        scrapeListe: async (cfg) => {
          if (cfg.cookie === 'c-34') throw new Error('CW down');
          return { ecritures: [] };
        },
        syncCaisse: async (_g, cfg) => {
          vues.push(cfg.cookie);
          return RESULTAT_CAISSE;
        },
      }),
    );
    expect(vues).toEqual(['c-33']);
  });

  it('aucun exercice abouti : pas de pas caisse', async () => {
    const syncCaisse = vi.fn(async () => RESULTAT_CAISSE);
    const res = await runSyncCycle(
      db,
      'g1',
      opts({
        scrapeListe: async () => {
          throw new Error('CW down');
        },
        syncCaisse,
      }),
    );
    expect(res.status).toBe('failed');
    expect(res.caisse).toBeNull();
    expect(syncCaisse).not.toHaveBeenCalled();
  });
});
