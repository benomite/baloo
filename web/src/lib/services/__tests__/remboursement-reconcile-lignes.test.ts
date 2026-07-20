import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let uuidSeq = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => `NEW-${++uuidSeq}` };
});

import { reconcileLignes, listLignes } from '../remboursements';

const SETUP = `
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, total_cents INTEGER, amount_cents INTEGER, updated_at TEXT);
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY, remboursement_id TEXT NOT NULL, date_depense TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, nature TEXT NOT NULL, notes TEXT,
    type TEXT DEFAULT 'depense', distance_km_dixiemes INTEGER, taux_km_millicents INTEGER,
    created_at TEXT
  );
  CREATE TABLE remboursement_ligne_justificatifs (
    ligne_id TEXT NOT NULL, justificatif_id TEXT NOT NULL, created_at TEXT,
    PRIMARY KEY (ligne_id, justificatif_id)
  );
`;

async function setup(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  await db.prepare("INSERT INTO remboursements (id, group_id, total_cents, amount_cents) VALUES ('RBT-1','g',0,0)").run();
  await db.prepare(
    "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, type, created_at) VALUES ('L1','RBT-1','2026-06-01',1000,'A','depense','t1')",
  ).run();
  await db.prepare(
    "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, type, created_at) VALUES ('L2','RBT-1','2026-06-02',2000,'B','depense','t2')",
  ).run();
  return db;
}

async function assignations(db: DbWrapper): Promise<string[]> {
  const rows = await db.prepare('SELECT ligne_id FROM remboursement_ligne_justificatifs ORDER BY ligne_id').all<{ ligne_id: string }>();
  return rows.map((r) => r.ligne_id);
}

describe('reconcileLignes', () => {
  beforeEach(async () => {
    uuidSeq = 0;
    testDb = await setup();
    // Rattachement justif sur L1.
    await testDb.prepare("INSERT INTO remboursement_ligne_justificatifs (ligne_id, justificatif_id, created_at) VALUES ('L1','J1','t')").run();
  });

  it('préserve l\'id + le rattachement d\'une ligne inchangée, UPDATE en place', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'L1', date_depense: '2026-06-01', amount_cents: 1500, nature: 'A modifié' },
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['L1', 'L2']);
    const l1 = lignes.find((l) => l.id === 'L1')!;
    expect(l1.amount_cents).toBe(1500);
    expect(l1.nature).toBe('A modifié');
    // Le rattachement justif de L1 survit (id préservé).
    expect(await assignations(testDb)).toEqual(['L1']);
  });

  it('INSERT une nouvelle ligne (id null) avec un nouvel id', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'L1', date_depense: '2026-06-01', amount_cents: 1000, nature: 'A' },
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
      { id: null, date_depense: '2026-06-03', amount_cents: 500, nature: 'C' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['L1', 'L2', 'NEW-1']);
  });

  it('DELETE une ligne retirée + ses paires justif ; recalcTotal', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['L2']);
    // Le rattachement de L1 (supprimée) est parti.
    expect(await assignations(testDb)).toEqual([]);
    const r = await testDb.prepare('SELECT total_cents FROM remboursements WHERE id=?').get<{ total_cents: number }>('RBT-1');
    expect(r?.total_cents).toBe(2000);
  });

  it('un id inconnu est traité comme une nouvelle ligne', async () => {
    await reconcileLignes('RBT-1', [
      { id: 'INEXISTANT', date_depense: '2026-06-05', amount_cents: 300, nature: 'Z' },
    ]);
    const lignes = await listLignes('RBT-1');
    expect(lignes.map((l) => l.id)).toEqual(['NEW-1']);
  });

  it('préserve les notes existantes d\'une ligne conservée quand l\'input ne les fournit pas', async () => {
    await testDb.prepare("UPDATE remboursement_lignes SET notes = 'note initiale' WHERE id = 'L1'").run();
    await reconcileLignes('RBT-1', [
      { id: 'L1', date_depense: '2026-06-01', amount_cents: 1500, nature: 'A modifié' },
      { id: 'L2', date_depense: '2026-06-02', amount_cents: 2000, nature: 'B' },
    ]);
    const lignes = await listLignes('RBT-1');
    const l1 = lignes.find((l) => l.id === 'L1')!;
    expect(l1.notes).toBe('note initiale');
  });
});
