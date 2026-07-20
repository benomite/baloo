import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import {
  listAssignationsLignes,
  setJustificatifLignes,
  computeCouverture,
} from '../remboursement-justifs';

const SETUP = `
  CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT);
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY, remboursement_id TEXT NOT NULL, date_depense TEXT,
    amount_cents INTEGER, nature TEXT, notes TEXT, type TEXT, created_at TEXT
  );
  CREATE TABLE justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, uploaded_at TEXT
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
  for (const l of ['L1', 'L2', 'L3']) {
    await db.prepare(
      "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature) VALUES (?, 'RBT-1', '2026-06-01', 1000, 'x')",
    ).run(l);
  }
  // Ligne d'une AUTRE demande.
  await db.prepare(
    "INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature) VALUES ('LX','RBT-2','2026-06-01',1000,'x')",
  ).run();
  // Justif de RBT-1 + justif d'une autre demande.
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J1','g','p/j1','j1.pdf','remboursement','RBT-1')",
  ).run();
  await db.prepare(
    "INSERT INTO justificatifs (id, group_id, file_path, original_filename, entity_type, entity_id) VALUES ('J2','g','p/j2','j2.pdf','remboursement','RBT-2')",
  ).run();
  return db;
}

describe('remboursement-justifs', () => {
  beforeEach(async () => {
    testDb = await setup();
  });

  it('setJustificatifLignes affecte un justif à plusieurs lignes', async () => {
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L1', 'L2']);
    const a = await listAssignationsLignes('RBT-1');
    expect(a.map((x) => x.ligne_id).sort()).toEqual(['L1', 'L2']);
    expect(a.every((x) => x.justificatif_id === 'J1')).toBe(true);
  });

  it('setJustificatifLignes remplace l\'ensemble (retire les décochées)', async () => {
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L1', 'L2']);
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L3']);
    const a = await listAssignationsLignes('RBT-1');
    expect(a.map((x) => x.ligne_id)).toEqual(['L3']);
  });

  it('setJustificatifLignes([]) retire toutes les affectations du justif', async () => {
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['L1']);
    await setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', []);
    expect(await listAssignationsLignes('RBT-1')).toHaveLength(0);
  });

  it('refuse un justif d\'une autre demande', async () => {
    await expect(
      setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J2', ['L1']),
    ).rejects.toThrow();
  });

  it('refuse une ligne d\'une autre demande', async () => {
    await expect(
      setJustificatifLignes({ groupId: 'g' }, 'RBT-1', 'J1', ['LX']),
    ).rejects.toThrow();
  });

  it('computeCouverture compte les lignes ayant ≥1 justif', () => {
    const lignes = [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }];
    const assignations = [
      { ligne_id: 'L1' },
      { ligne_id: 'L1' },
      { ligne_id: 'L3' },
    ];
    expect(computeCouverture(lignes, assignations)).toEqual({ justifiees: 2, total: 3 });
  });

  it('computeCouverture sur 0 ligne', () => {
    expect(computeCouverture([], [])).toEqual({ justifiees: 0, total: 0 });
  });
});
