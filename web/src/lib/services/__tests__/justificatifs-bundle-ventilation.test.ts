import { it, expect, beforeEach, vi } from 'vitest';
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

// Le panneau d'une ligne consolidée représente TOUT le groupe de ventilation
// (le tick « justif » de la table est calculé sur `members.some(...)`). Le
// bundle doit donc couvrir le groupe entier, sinon une pièce accrochée à une
// autre ligne du groupe reste invisible — cas réel prod 2026-07-27 : les 5
// demandes liées à la tête du virement groupé MERSCH n'apparaissaient pas.
it('remboursements du GROUPE visibles depuis n’importe quel membre', async () => {
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'C');
  expect(bundle.viaRemboursement.map((r) => r.remboursementId)).toEqual(['R1']);
});

it('justif direct posé sur une autre ligne du groupe reste visible', async () => {
  await testDb.prepare("INSERT INTO justificatifs VALUES ('J1','g','ecriture','C','2026-07-25T10:00:00Z')").run();
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'H');
  expect(bundle.direct.map((j) => j.id)).toEqual(['J1']);
});

it('hors groupe : ni les justifs ni les rembs des autres écritures ne fuient', async () => {
  await testDb.prepare("INSERT INTO ecritures VALUES ('X','g',5000,NULL)").run();
  await testDb.prepare("INSERT INTO justificatifs VALUES ('JX','g','ecriture','X','2026-07-25T10:00:00Z')").run();
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'H');
  expect(bundle.direct).toHaveLength(0);
  const other = await listJustificatifsForEcriture({ groupId: 'g' }, 'X');
  expect(other.direct.map((j) => j.id)).toEqual(['JX']);
  expect(other.viaRemboursement).toHaveLength(0);
});

it('sans groupe : ventilationGroupTotalCents = montant propre', async () => {
  await testDb.prepare("INSERT INTO ecritures VALUES ('SOLO','g',9900,NULL)").run();
  const bundle = await listJustificatifsForEcriture({ groupId: 'g' }, 'SOLO');
  expect(bundle.ventilationGroupTotalCents).toBe(9900);
});
