// Critère 1 (#61) : sync_run met aussi la caisse à jour depuis Comptaweb —
// mouvements et solde CW — sans étape séparée (plus besoin de cw_sync_caisse).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../../db/business-schema';
import { runSyncCycle, type SyncCycleOptions } from '../sync-cycle';
import { syncCaisseFromComptaweb, persistCaisseSync } from '../caisse-sync';

vi.mock('../caisse-sync', () => ({
  syncCaisseFromComptaweb: vi.fn(async () => ({
    caisseId: 1,
    libelle: 'Caisse principale',
    soldeComptaweb: 5000,
    soldeBaloo: 5000,
    stats: { pulled: 1, inserted: 1, matched_by_cw_id: 0, matched_by_fallback: 0, unchanged: 0 },
  })),
  persistCaisseSync: vi.fn(async () => ({
    caisseId: 1,
    libelle: 'Caisse principale',
    soldeComptaweb: 5000,
    soldeBaloo: 5000,
    stats: { pulled: 1, inserted: 1, matched_by_cw_id: 0, matched_by_fallback: 0, unchanged: 0 },
  })),
  discoverCaisses: vi.fn(async () => [
    { id: 1, libelle: 'Caisse principale', gerant: 'X', devise: 'EUR', inactif: false },
  ]),
  resolveCaisseId: vi.fn(async () => 1),
}));

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

function opts(): SyncCycleOptions {
  return {
    trigger: 'mcp',
    force: true,
    loadConfig: async () => ({ baseUrl: 'http://test', cookie: 'fake' }),
    scrapeListe: async () => ({ ecritures: [] }),
    scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
    scrapeDetail: async () => ({ ventilations: [] }),
    resolveActiviteId: async () => null,
    resolveUniteId: async () => null,
    resolveCategoryId: async () => null,
  };
}

describe('sync_run — caisse (#61)', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    vi.clearAllMocks();
    const client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    db = wrapClient(client);
    await db.exec(DDL);
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
  });

  it('un cycle de sync met la caisse à jour depuis Comptaweb (mouvements + solde)', async () => {
    const res = await runSyncCycle(db, 'g1', opts());
    expect(res.status).toBe('ok');
    const appels =
      vi.mocked(syncCaisseFromComptaweb).mock.calls.length +
      vi.mocked(persistCaisseSync).mock.calls.length;
    expect(appels).toBeGreaterThan(0);
  });
});
