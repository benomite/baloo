// Parcours déposeur (#22) : « mes dépôts » (filtre par déposeur, isolé par
// groupe) et garde ownership / statut pour voir et modifier un dépôt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});
vi.mock('../../ids', () => ({
  nextId: async (p: string) => `${p}-X`,
  currentTimestamp: () => '2026-07-08T10:00:00Z',
}));

import { canEditDepot, canViewDepot, listDepots, getDepot } from '../depots';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, submitted_by_user_id TEXT, titre TEXT NOT NULL,
      description TEXT, category_id TEXT, unite_id TEXT, amount_cents INTEGER,
      date_estimee TEXT, carte_id TEXT, activite_id TEXT, statut TEXT NOT NULL DEFAULT 'a_traiter',
      ecriture_id TEXT, remboursement_id TEXT, motif_rejet TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT, file_path TEXT,
      uploaded_at TEXT, obsolete_at TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, nom_affichage TEXT, email TEXT);
    CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT);
    INSERT INTO users VALUES ('u1', 'Alice', 'a@x.fr'), ('u2', 'Bob', 'b@x.fr');
  `);
  return db;
}

async function insert(db: DbWrapper, id: string, group: string, user: string, statut = 'a_traiter') {
  await db
    .prepare(
      `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, statut, created_at, updated_at)
       VALUES (?, ?, ?, 'T', ?, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')`,
    )
    .run(id, group, user, statut);
}

describe('mes dépôts — listDepots filtré par déposeur', () => {
  beforeEach(async () => {
    testDb = await setup();
    await insert(testDb, 'D1', 'g', 'u1');
    await insert(testDb, 'D2', 'g', 'u1', 'rattache');
    await insert(testDb, 'D3', 'g', 'u1', 'rejete');
    await insert(testDb, 'D4', 'g', 'u2');
    await insert(testDb, 'D5', 'autre', 'u1');
  });

  it('retourne tous les statuts de l’owner, pas ceux des autres', async () => {
    const mine = await listDepots({ groupId: 'g' }, { submitted_by_user_id: 'u1' });
    expect(mine.map((d) => d.id).sort()).toEqual(['D1', 'D2', 'D3']);
  });

  it('est isolé par groupe', async () => {
    const mine = await listDepots({ groupId: 'autre' }, { submitted_by_user_id: 'u1' });
    expect(mine.map((d) => d.id)).toEqual(['D5']);
    expect(await getDepot({ groupId: 'g' }, 'D5')).toBeNull();
  });
});

describe('canViewDepot / canEditDepot', () => {
  const owner = { userId: 'u1', isAdmin: false };
  const other = { userId: 'u2', isAdmin: false };
  const admin = { userId: 'u3', isAdmin: true };
  const dep = (statut: 'a_traiter' | 'rattache' | 'rejete') => ({ submitted_by_user_id: 'u1', statut });

  it('l’owner voit et édite son dépôt à traiter', () => {
    expect(canViewDepot(dep('a_traiter'), owner)).toBe(true);
    expect(canEditDepot(dep('a_traiter'), owner)).toBe(true);
  });

  it('l’owner n’édite pas un dépôt rattaché ou rejeté, mais le voit', () => {
    for (const s of ['rattache', 'rejete'] as const) {
      expect(canViewDepot(dep(s), owner)).toBe(true);
      expect(canEditDepot(dep(s), owner)).toBe(false);
    }
  });

  it('un autre membre ne voit ni n’édite le dépôt', () => {
    expect(canViewDepot(dep('a_traiter'), other)).toBe(false);
    expect(canEditDepot(dep('a_traiter'), other)).toBe(false);
  });

  it('l’admin garde l’accès (édition limitée au statut à traiter)', () => {
    expect(canViewDepot(dep('rattache'), admin)).toBe(true);
    expect(canEditDepot(dep('a_traiter'), admin)).toBe(true);
    expect(canEditDepot(dep('rejete'), admin)).toBe(false);
  });
});
