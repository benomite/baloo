import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { listAssignationsLignes, setLigneJustificatifs } from '../remboursement-justifs';

const SETUP = `
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT);
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY, remboursement_id TEXT NOT NULL, date_depense TEXT,
    amount_cents INTEGER, nature TEXT, notes TEXT, type TEXT, created_at TEXT
  );
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, uploaded_at TEXT,
    obsolete_at TEXT
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
  await db.prepare("INSERT INTO remboursements (id, group_id) VALUES ('RBT-1','g')").run();
  await db.prepare("INSERT INTO remboursements (id, group_id) VALUES ('RBT-2','g')").run();
  for (const l of ['L1', 'L2']) {
    await db.prepare(
      "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature) VALUES (?, 'RBT-1', '2026-06-01', 1000, 'x')",
    ).run(l);
  }
  // Justifs de RBT-1 + un justif d'une autre demande.
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J1','g','p/j1','j1.pdf','remboursement','RBT-1')",
  ).run();
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J2','g','p/j2','j2.pdf','remboursement','RBT-1')",
  ).run();
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J-AUTRE','g','p/ja','ja.pdf','remboursement','RBT-2')",
  ).run();
  return db;
}

describe('setLigneJustificatifs', () => {
  beforeEach(async () => {
    testDb = await setup();
  });

  it('rattache J1 et J2 à la ligne L1', async () => {
    await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1', 'J2']);
    const a = await listAssignationsLignes('RBT-1');
    expect(a.filter((x) => x.ligne_id === 'L1').map((x) => x.justificatif_id).sort()).toEqual(['J1', 'J2']);
  });

  it('remplace la sélection (retire J2, garde J1)', async () => {
    await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1', 'J2']);
    await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1']);
    const a = await listAssignationsLignes('RBT-1');
    expect(a.filter((x) => x.ligne_id === 'L1').map((x) => x.justificatif_id)).toEqual(['J1']);
  });

  it('liste vide = retire tous les justifs de la ligne', async () => {
    await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1']);
    await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', []);
    expect((await listAssignationsLignes('RBT-1')).filter((x) => x.ligne_id === 'L1')).toHaveLength(0);
  });

  it("rejette un justif d'une autre demande", async () => {
    await expect(setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J-AUTRE'])).rejects.toThrow();
  });

  it("rejette une ligne d'une autre demande", async () => {
    await expect(setLigneJustificatifs({ groupId: 'g' }, 'RBT-2', 'L1', ['J1'])).rejects.toThrow();
  });
});
