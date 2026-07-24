import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
let testClient: Client;
let idCounter = 0;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextIdOn: async (_db: unknown, p: string) => `${p}-${++idCounter}`,
  nextId: async (p: string) => `${p}-${++idCounter}`,
  currentTimestamp: () => '2026-07-24T10:00:00Z',
}));

import { syncEcritureVentilationFromRembs, setRembsEcritureLink } from '../remboursement-ecriture-link';

// Transaction libsql → schéma créé une seule fois, cache partagé (cf. ecritures-ventilate.test.ts).
beforeAll(async () => {
  testClient = createClient({ url: 'file::memory:?cache=shared' });
  await testClient.execute('PRAGMA foreign_keys = OFF');
  testDb = wrapClient(testClient);
  await testDb.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT,
      mode_paiement_id TEXT, activite_id TEXT, numero_piece TEXT, carte_id TEXT,
      justif_attendu INTEGER DEFAULT 1, notes TEXT, ligne_bancaire_id INTEGER,
      ligne_bancaire_sous_index INTEGER, libelle_origine TEXT,
      ventilation_group_id TEXT, comptaweb_ecriture_id INTEGER,
      status TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE remboursements (
      id TEXT PRIMARY KEY, group_id TEXT, amount_cents INTEGER, total_cents INTEGER,
      unite_id TEXT, ecriture_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, group_id TEXT, entity_type TEXT, entity_id TEXT);
    CREATE TABLE depots_justificatifs (id TEXT, ecriture_id TEXT);
  `);
});
afterAll(async () => { await testClient.close(); });

// Virement draft de 470,32 € (47032 c) + demandes liées paramétrables.
async function seedVirement(amount = 47032): Promise<void> {
  idCounter = 0;
  await testDb.exec('DELETE FROM ecritures; DELETE FROM remboursements;');
  await testDb.prepare(
    `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, status, created_at, updated_at)
     VALUES ('ECR','g','2026-07-20','VIREMENT FLORENCE',?, 'depense','draft','t','t')`,
  ).run(amount);
}
async function addRemb(id: string, total: number, unite: string | null, created: string): Promise<void> {
  await testDb.prepare(
    `INSERT INTO remboursements (id, group_id, amount_cents, total_cents, unite_id, ecriture_id, created_at)
     VALUES (?,?,?,?,?,'ECR',?)`,
  ).run(id, 'g', total, total, unite, created);
}
async function lignes(): Promise<Array<{ id: string; amount_cents: number; unite_id: string | null; vg: string | null }>> {
  return await testDb.prepare(
    'SELECT id, amount_cents, unite_id, ventilation_group_id AS vg FROM ecritures WHERE group_id=? ORDER BY amount_cents DESC',
  ).all<{ id: string; amount_cents: number; unite_id: string | null; vg: string | null }>('g');
}

describe('syncEcritureVentilationFromRembs', () => {
  beforeEach(async () => { await seedVirement(); });

  it('2 demandes couvrant exactement → 2 lignes sur leurs unités, tête préservée', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 17032, 'u-far', '2026-07-02');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount_cents).sort((a, b) => a - b)).toEqual([17032, 30000]);
    expect(rows.every((r) => r.vg && r.vg === rows[0].vg)).toBe(true);
    expect(rows.some((r) => r.id === 'ECR')).toBe(true); // tête réutilisée
    expect(rows.map((r) => r.unite_id).sort()).toEqual(['u-far', 'u-lj']);
  });

  it('sous-couverture → lignes demandes + ligne « reste »', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(2); // R1 (30000) + reste (17032)
    expect(rows.map((r) => r.amount_cents).sort((a, b) => a - b)).toEqual([17032, 30000]);
    const reste = rows.find((r) => r.amount_cents === 17032)!;
    expect(reste.unite_id).toBeNull();
  });

  it('dépassement → aucune ventilation, écriture inchangée', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 25000, 'u-far', '2026-07-02'); // 55000 > 47032
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(47032);
    expect(rows[0].vg).toBeNull();
  });

  it('délien 2→1 (exact) → repli en mono-ligne, enfants supprimés', async () => {
    await addRemb('R1', 47032, 'u-lj', '2026-07-01');
    await addRemb('R2', 0, 'u-far', '2026-07-02'); // placeholder retiré ensuite
    // simulate 2 puis retrait de R2 : on relie R2 avec un montant réel puis on le retire
    await testDb.prepare("UPDATE remboursements SET total_cents=17000, amount_cents=17000 WHERE id='R2'").run();
    await testDb.prepare("UPDATE remboursements SET total_cents=30032, amount_cents=30032 WHERE id='R1'").run();
    await syncEcritureVentilationFromRembs('g', 'ECR'); // ventile en 2
    expect(await lignes()).toHaveLength(2);
    // retrait de R2
    await testDb.prepare("UPDATE remboursements SET ecriture_id=NULL WHERE id='R2'").run();
    await testDb.prepare("UPDATE remboursements SET total_cents=47032, amount_cents=47032 WHERE id='R1'").run();
    await syncEcritureVentilationFromRembs('g', 'ECR'); // repli
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('ECR');
    expect(rows[0].amount_cents).toBe(47032);
    expect(rows[0].unite_id).toBe('u-lj');
    expect(rows[0].vg).toBeNull();
  });

  it('demande unique jamais ventilée → COALESCE unité, pas de ventilation', async () => {
    await addRemb('R1', 47032, 'u-lj', '2026-07-01');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].vg).toBeNull();
    expect(rows[0].unite_id).toBe('u-lj');
  });

  it('COALESCE non destructif : une unité déjà posée n\'est pas écrasée', async () => {
    await testDb.prepare("UPDATE ecritures SET unite_id='u-deja' WHERE id='ECR'").run();
    await addRemb('R1', 47032, 'u-lj', '2026-07-01');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    const rows = await lignes();
    expect(rows[0].unite_id).toBe('u-deja');
  });

  it('écriture non-draft → no-op', async () => {
    await testDb.prepare("UPDATE ecritures SET status='mirror' WHERE id='ECR'").run();
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 17032, 'u-far', '2026-07-02');
    await syncEcritureVentilationFromRembs('g', 'ECR');
    expect(await lignes()).toHaveLength(1);
  });
});

describe('setRembsEcritureLink → ventilation auto', () => {
  beforeEach(async () => { await seedVirement(); });

  it('lier une 2e demande ventile le virement en 2 lignes', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01'); // déjà liée
    // R2 pas encore liée (ecriture_id NULL)
    await testDb.prepare(
      "INSERT INTO remboursements (id, group_id, amount_cents, total_cents, unite_id, created_at) VALUES ('R2','g',17032,17032,'u-far','2026-07-02')",
    ).run();
    const res = await setRembsEcritureLink('g', 'R2', 'ECR');
    expect(res.ok).toBe(true);
    const rows = await lignes();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount_cents).sort((a, b) => a - b)).toEqual([17032, 30000]);
  });

  it('délier la 2e demande replie en mono-ligne', async () => {
    await addRemb('R1', 30000, 'u-lj', '2026-07-01');
    await addRemb('R2', 17032, 'u-far', '2026-07-02');
    await syncEcritureVentilationFromRembs('g', 'ECR'); // ventilé en 2
    expect(await lignes()).toHaveLength(2);
    // R1 est corrigée pour couvrir tout le virement une fois R2 délié (sinon
    // le reste des 17032 c non couverts redevient une ligne « reste à imputer »
    // — cf. test « sous-couverture » ci-dessus, comportement volontaire).
    await testDb.prepare("UPDATE remboursements SET total_cents=47032, amount_cents=47032 WHERE id='R1'").run();
    const res = await setRembsEcritureLink('g', 'R2', null); // délien
    expect(res.ok).toBe(true);
    const rows = await lignes();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_cents).toBe(47032);
  });
});
