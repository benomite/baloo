// syncDraftToComptaweb débridé : quand l'écriture appartient à un groupe de
// ventilation (ventilation_group_id non nul), la sync doit assembler TOUTES
// les lignes du groupe en N ventilations, faire 1 SEUL POST Comptaweb (montant
// = total du groupe), puis passer TOUT le groupe en `mirror` atomiquement.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
const createEcriture = vi.fn();

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async (cb: (cfg: unknown) => unknown) => cb({}),
  createEcriture: (...a: unknown[]) => createEcriture(...a),
  listRapprochementBancaire: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
vi.mock('../../ids', () => ({
  currentTimestamp: () => '2026-07-13T10:00:00Z',
  nextId: async (p: string) => `${p}-X`,
}));

import { syncDraftToComptaweb } from '../drafts';

// db.transaction() sur une BDD file::memory: NUE ouvre une connexion VIDE
// (piège libsql). Avec ?cache=shared la transaction voit bien les tables —
// mais deux clients partageant le même cache voient le même CREATE TABLE,
// d'où schéma en beforeAll et reset des données en beforeEach.
async function makeDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  await client.execute('PRAGMA foreign_keys = OFF');
  return wrapClient(client);
}

beforeAll(async () => {
  testDb = await makeDb();
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT, activite_id TEXT,
      mode_paiement_id TEXT, numero_piece TEXT, status TEXT, justif_attendu INTEGER,
      carte_id TEXT, ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
      comptaweb_synced INTEGER DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT, uploaded_at TEXT);
    CREATE TABLE categories (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE activites (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE unites (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE modes_paiement (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT, type TEXT, comptaweb_id INTEGER);
  `);
});

async function resetData(): Promise<void> {
  await testDb.exec(`
    DELETE FROM ecritures;
    DELETE FROM justificatifs;
    DELETE FROM categories;
    DELETE FROM activites;
    DELETE FROM unites;
    DELETE FROM modes_paiement;
    DELETE FROM cartes;
  `);
  await testDb.exec(`
    INSERT INTO categories VALUES ('c-int', 11), ('c-pharma', 22);
    INSERT INTO activites VALUES ('a-camps', 5);
    INSERT INTO unites VALUES ('u-farfa', 7);
    INSERT INTO modes_paiement VALUES ('m-cb', 3);
    INSERT INTO ecritures (
      id, group_id, date_ecriture, description, amount_cents, type, unite_id, category_id,
      activite_id, mode_paiement_id, status, justif_attendu, ventilation_group_id, comptaweb_ecriture_id
    ) VALUES
      ('E1','g1','2026-05-13','LECLERC',700,'depense','u-farfa','c-int','a-camps','m-cb','draft',1,'vg_1',NULL),
      ('E2','g1','2026-05-13','LECLERC',364,'depense','u-farfa','c-pharma','a-camps','m-cb','draft',1,'vg_1',NULL);
  `);
}

describe('syncDraftToComptaweb — groupe multi-ventilation', () => {
  beforeEach(async () => {
    createEcriture.mockReset();
    await resetData();
  });

  it('envoie N ventilations, montant = total, et passe TOUT le groupe en mirror', async () => {
    createEcriture.mockResolvedValue({ dryRun: false, ecritureId: 5001 });
    const res = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: false });
    expect(res.ok).toBe(true);

    // 1 seul POST CW.
    expect(createEcriture).toHaveBeenCalledTimes(1);
    const input = createEcriture.mock.calls[0][1] as {
      montant: string;
      ventilations: Array<{ montant: string; natureId: string }>;
    };
    expect(input.montant).toBe('10,64');
    expect(input.ventilations).toHaveLength(2);
    expect(input.ventilations.map((v) => v.natureId).sort()).toEqual(['11', '22']);

    // Les 2 lignes du groupe passent mirror + synced, avec le même id CW.
    const rows = await testDb
      .prepare("SELECT status, comptaweb_synced, comptaweb_ecriture_id FROM ecritures WHERE group_id='g1'")
      .all<{ status: string; comptaweb_synced: number; comptaweb_ecriture_id: number }>();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'mirror' && r.comptaweb_synced === 1 && r.comptaweb_ecriture_id === 5001)).toBe(true);
  });

  it('dry-run : ne mute rien', async () => {
    createEcriture.mockResolvedValue({ dryRun: true });
    const res = await syncDraftToComptaweb({ groupId: 'g1' }, 'E1', { dryRun: true });
    expect(res.dryRun).toBe(true);
    const rows = await testDb.prepare("SELECT status FROM ecritures WHERE group_id='g1'").all<{ status: string }>();
    expect(rows.every((r) => r.status === 'draft')).toBe(true);
  });
});
