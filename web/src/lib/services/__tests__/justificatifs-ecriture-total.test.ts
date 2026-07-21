import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { listJustificatifsForEcriture } from '../justificatifs';

describe('listJustificatifsForEcriture — totalCents par demande liée', () => {
  beforeEach(async () => {
    const client: Client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, demandeur TEXT, amount_cents INTEGER, total_cents INTEGER, ecriture_id TEXT);
      CREATE TABLE justificatifs (id TEXT PRIMARY KEY, group_id TEXT NOT NULL, file_path TEXT NOT NULL, original_filename TEXT NOT NULL, mime_type TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, uploaded_at TEXT);
    `);
    await testDb.prepare("INSERT INTO remboursements (id, group_id, demandeur, amount_cents, total_cents, ecriture_id) VALUES ('R1','g','Florence',30000,30000,'ECR')").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, demandeur, amount_cents, total_cents, ecriture_id) VALUES ('R2','g','Florence',20000,20000,'ECR')").run();
  });

  it('chaque demande liée porte son total en centimes', async () => {
    const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'ECR');
    const totby = Object.fromEntries(bundle.viaRemboursement.map((r) => [r.remboursementId, r.totalCents]));
    expect(totby).toEqual({ R1: 30000, R2: 20000 });
  });
});
