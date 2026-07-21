import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { computeRembsCoverage, getEcritureRembsCoverage } from '../remboursement-ecriture-link';

describe('computeRembsCoverage (pur)', () => {
  it('couverture exacte : reste 0, pas de dépassement', () => {
    expect(computeRembsCoverage(50000, [30000, 20000])).toEqual({
      nbDemandes: 2, sommeDemandesCents: 50000, montantVirementCents: 50000, resteCents: 0, depasse: false,
    });
  });
  it('sous-couverture : reste positif', () => {
    const c = computeRembsCoverage(50000, [30000]);
    expect(c.resteCents).toBe(20000);
    expect(c.depasse).toBe(false);
  });
  it('sur-couverture : depasse=true, reste négatif', () => {
    const c = computeRembsCoverage(50000, [30000, 30000]);
    expect(c.sommeDemandesCents).toBe(60000);
    expect(c.resteCents).toBe(-10000);
    expect(c.depasse).toBe(true);
  });
  it('0 demande', () => {
    expect(computeRembsCoverage(50000, [])).toMatchObject({ nbDemandes: 0, sommeDemandesCents: 0, resteCents: 50000, depasse: false });
  });
  it('valeur absolue : montant écriture négatif traité comme positif', () => {
    const c = computeRembsCoverage(-50000, [20000]);
    expect(c.montantVirementCents).toBe(50000);
    expect(c.resteCents).toBe(30000);
  });
});

describe('getEcritureRembsCoverage', () => {
  beforeEach(async () => {
    const client: Client = createClient({ url: 'file::memory:' });
    await client.execute('PRAGMA foreign_keys = OFF');
    testDb = wrapClient(client);
    await testDb.exec(`
      CREATE TABLE ecritures (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER);
      CREATE TABLE remboursements (id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER, ecriture_id TEXT);
    `);
    await testDb.prepare("INSERT INTO ecritures (id, group_id, amount_cents) VALUES ('ECR','g',50000)").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('R1','g',30000,30000,'ECR')").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('R2','g',15000,15000,'ECR')").run();
    await testDb.prepare("INSERT INTO remboursements (id, group_id, amount_cents, total_cents, ecriture_id) VALUES ('R3','g',9999,9999,NULL)").run();
  });

  it('somme les totaux des demandes liées vs montant écriture', async () => {
    const c = await getEcritureRembsCoverage('g', 'ECR');
    expect(c.nbDemandes).toBe(2);
    expect(c.sommeDemandesCents).toBe(45000);
    expect(c.montantVirementCents).toBe(50000);
    expect(c.resteCents).toBe(5000);
    expect(c.depasse).toBe(false);
  });
});
