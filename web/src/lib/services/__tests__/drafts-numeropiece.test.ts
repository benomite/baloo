// Au push vers Comptaweb (syncDraftToComptaweb), le n° pièce ne doit plus
// retomber sur l'ID de l'écriture quand aucun justif n'est attendu : une
// recette sans justif part SANS n° pièce (pas de pièce bidon orpheline côté
// CW — demande terrain 2026-06-30). Une dépense (justif attendu) garde le repli.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;
const captured: { input?: { numeropiece?: string } } = {};

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../comptaweb/env-loader', () => ({ ensureComptawebEnv: () => {} }));
vi.mock('../../comptaweb', () => ({
  withAutoReLogin: async (cb: (cfg: unknown) => unknown) => cb({}),
  createEcriture: async (_cfg: unknown, input: { numeropiece?: string }) => {
    captured.input = input;
    return { dryRun: false, ecritureId: 999 };
  },
  listRapprochementBancaire: vi.fn(),
  ComptawebSessionExpiredError: class extends Error {},
}));
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-X`,
  currentTimestamp: () => '2026-06-30T10:00:00Z',
}));

import { syncDraftToComptaweb } from '../drafts';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      amount_cents INTEGER, type TEXT, unite_id TEXT, category_id TEXT, activite_id TEXT,
      mode_paiement_id TEXT, numero_piece TEXT, status TEXT, justif_attendu INTEGER,
      carte_id TEXT, comptaweb_ecriture_id INTEGER, comptaweb_synced INTEGER DEFAULT 0,
      ventilation_group_id TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT, uploaded_at TEXT);
    CREATE TABLE categories (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE activites (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE unites (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE modes_paiement (id TEXT, comptaweb_id INTEGER);
    CREATE TABLE cartes (id TEXT, type TEXT, comptaweb_id INTEGER);
    INSERT INTO categories VALUES ('c1', 10);
    INSERT INTO activites VALUES ('a1', 40);
    INSERT INTO unites VALUES ('u1', 20);
    INSERT INTO modes_paiement VALUES ('m1', 30);
  `);
  return db;
}

async function insertEcriture(db: DbWrapper, o: { id: string; type: string; justif: number }) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type,
         unite_id, category_id, activite_id, mode_paiement_id, numero_piece, status, justif_attendu,
         carte_id, comptaweb_ecriture_id)
       VALUES (?, 'g', '2026-06-23', 'Libellé', 4500, ?, 'u1', 'c1', 'a1', 'm1', NULL, 'draft', ?, NULL, NULL)`,
    )
    .run(o.id, o.type, o.justif);
}

describe('syncDraftToComptaweb — n° pièce selon justif attendu', () => {
  beforeEach(async () => { testDb = await setup(); captured.input = undefined; });

  it('recette sans justif attendu → AUCUN n° pièce envoyé à Comptaweb', async () => {
    await insertEcriture(testDb, { id: 'REC-1', type: 'recette', justif: 0 });
    const res = await syncDraftToComptaweb({ groupId: 'g' }, 'REC-1', { dryRun: false });
    expect(res.ok).toBe(true);
    // numeropiece: '' || undefined → pas de pièce
    expect(captured.input?.numeropiece).toBeUndefined();
  });

  it('dépense (justif attendu) → repli sur l’ID de l’écriture', async () => {
    await insertEcriture(testDb, { id: 'DEP-1', type: 'depense', justif: 1 });
    const res = await syncDraftToComptaweb({ groupId: 'g' }, 'DEP-1', { dryRun: false });
    expect(res.ok).toBe(true);
    expect(captured.input?.numeropiece).toBe('DEP-1');
  });
});
