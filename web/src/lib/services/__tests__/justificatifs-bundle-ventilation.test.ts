import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { listJustificatifsForEcriture } from '../justificatifs';

beforeEach(async () => {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(client);
  await testDb.exec(`
    CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, ventilation_group_id TEXT);
    CREATE TABLE remboursements (id TEXT, group_id TEXT, demandeur TEXT, total_cents INTEGER, amount_cents INTEGER, ecriture_id TEXT);
    CREATE TABLE justificatifs (id TEXT, group_id TEXT, entity_type TEXT, entity_id TEXT, uploaded_at TEXT);
  `);
  await testDb.prepare("INSERT INTO ecritures VALUES ('H','g',30000,'vg1')").run();
  await testDb.prepare("INSERT INTO ecritures VALUES ('C','g',17032,'vg1')").run();
  await testDb.prepare("INSERT INTO remboursements VALUES ('R1','g','Florence',30000,30000,'H')").run();
});

it('expose ventilationGroupTotalCents = Σ du groupe', async () => {
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'H');
  expect(bundle.ventilationGroupTotalCents).toBe(47032);
});

it('sans groupe : ventilationGroupTotalCents = montant propre', async () => {
  await testDb.prepare("INSERT INTO ecritures VALUES ('SOLO','g',9900,NULL)").run();
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'SOLO');
  expect(bundle.ventilationGroupTotalCents).toBe(9900);
});
