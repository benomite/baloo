import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { findEcritureCandidatesForRembs, setRembsEcritureLink } from '../remboursement-ecriture-link';

const SETUP = `
  CREATE TABLE remboursements (
    id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER,
    date_depense TEXT, unite_id TEXT, ecriture_id TEXT, updated_at TEXT
  );
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT, type TEXT, amount_cents INTEGER,
    date_ecriture TEXT, description TEXT, unite_id TEXT, status TEXT
  );
  CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
`;

async function setup(): Promise<DbWrapper> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(SETUP);
  // Demande de 100,40 € le 2026-06-30.
  await db.prepare(
    "INSERT INTO remboursements (id, group_id, amount_cents, total_cents, date_depense) VALUES ('RBT-1','g',10040,10040,'2026-06-30')",
  ).run();
  // Autre demande liée au virement groupé.
  await db.prepare(
    "INSERT INTO remboursements (id, group_id, amount_cents, total_cents, date_depense, ecriture_id) VALUES ('RBT-2','g',20000,20000,'2026-06-15','ECR-VIREMENT')",
  ).run();
  // Écriture au montant EXACT de RBT-1.
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-EXACT','g','depense',10040,'2026-07-01','Virement Florence','mirror')",
  ).run();
  // Virement GROUPÉ (montant différent), déjà lié à RBT-2.
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-VIREMENT','g','depense',50000,'2026-07-02','Virement groupé Florence','mirror')",
  ).run();
  // Recette (jamais candidate) + dépense hors fenêtre.
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-REC','g','recette',10040,'2026-07-01','Cotisation','mirror')",
  ).run();
  await db.prepare(
    "INSERT INTO ecritures (id, group_id, type, amount_cents, date_ecriture, description, status) VALUES ('ECR-OLD','g','depense',10040,'2020-01-01','Vieux','mirror')",
  ).run();
  return db;
}

describe('findEcritureCandidatesForRembs', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('renvoie les écritures dépense de montant DIFFÉRENT (plus de filtre montant exact)', async () => {
    const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
    const ids = c.map((x) => x.id);
    expect(ids).toContain('ECR-EXACT');
    expect(ids).toContain('ECR-VIREMENT'); // montant 500 ≠ 100,40
    expect(ids).not.toContain('ECR-REC');  // recette exclue
    expect(ids).not.toContain('ECR-OLD');  // hors fenêtre ±1 an
  });

  it('inclut une écriture déjà liée à une autre demande + expose linked_count', async () => {
    const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
    const virement = c.find((x) => x.id === 'ECR-VIREMENT');
    expect(virement).toBeDefined();
    expect(virement!.linked_count).toBe(1);
  });

  it('trie le match de montant exact en tête', async () => {
    const c = await findEcritureCandidatesForRembs('g', 'RBT-1');
    expect(c[0].id).toBe('ECR-EXACT');
  });
});

describe('setRembsEcritureLink', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('autorise le lien vers une écriture déjà liée à une autre demande', async () => {
    const res = await setRembsEcritureLink('g', 'RBT-1', 'ECR-VIREMENT');
    expect(res.ok).toBe(true);
    const r = await testDb.prepare('SELECT ecriture_id FROM remboursements WHERE id=?').get<{ ecriture_id: string }>('RBT-1');
    expect(r?.ecriture_id).toBe('ECR-VIREMENT');
  });
});
