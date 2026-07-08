// Demande terrain 2026-07-08 : le trésorier veut pouvoir MODIFIER un dépôt de
// justificatifs encore « à traiter » (corriger titre, montant, date,
// imputation…), pas seulement le rejeter ou le rattacher. L'édition ne touche
// que les champs métier saisis par le déposeur : statut, liens (ecriture_id,
// remboursement_id) et justifs restent intacts, et on refuse d'éditer un dépôt
// déjà rattaché / rejeté.

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

import { updateDepot } from '../depots';

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
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
  `);
  return db;
}

interface DepotRow {
  titre: string;
  description: string | null;
  category_id: string | null;
  unite_id: string | null;
  amount_cents: number | null;
  date_estimee: string | null;
  carte_id: string | null;
  activite_id: string | null;
  statut: string;
  ecriture_id: string | null;
  remboursement_id: string | null;
  updated_at: string | null;
}

async function insertDepot(
  db: DbWrapper,
  o: { statut?: string; ecriture_id?: string | null; remboursement_id?: string | null } = {},
) {
  await db
    .prepare(
      `INSERT INTO depots_justificatifs
         (id, group_id, submitted_by_user_id, titre, description, category_id, unite_id,
          amount_cents, date_estimee, carte_id, activite_id, statut, ecriture_id,
          remboursement_id, created_at, updated_at)
       VALUES ('DEP-1', 'g', 'u1', 'Titre initial', 'desc initiale', 'CAT-A', 'UNI-A',
               1000, '2026-06-01', 'CARTE-A', 'ACT-A', ?, ?, ?, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')`,
    )
    .run(o.statut ?? 'a_traiter', o.ecriture_id ?? null, o.remboursement_id ?? null);
  await db.prepare(`INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('JUS-1', 'depot', 'DEP-1')`).run();
}

async function readDepot(db: DbWrapper): Promise<DepotRow> {
  return (await db.prepare('SELECT * FROM depots_justificatifs WHERE id = ?').get<DepotRow>('DEP-1'))!;
}

describe('updateDepot — édition trésorier d’un dépôt à traiter', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('met à jour les champs métier et touche à updated_at', async () => {
    await insertDepot(testDb);

    await updateDepot({ groupId: 'g' }, 'DEP-1', {
      titre: 'Titre corrigé',
      description: 'nouvelle desc',
      category_id: 'CAT-B',
      unite_id: 'UNI-B',
      amount_cents: 4250,
      date_estimee: '2026-06-20',
      carte_id: 'CARTE-B',
      activite_id: 'ACT-B',
    });

    const d = await readDepot(testDb);
    expect(d.titre).toBe('Titre corrigé');
    expect(d.description).toBe('nouvelle desc');
    expect(d.category_id).toBe('CAT-B');
    expect(d.unite_id).toBe('UNI-B');
    expect(d.amount_cents).toBe(4250);
    expect(d.date_estimee).toBe('2026-06-20');
    expect(d.carte_id).toBe('CARTE-B');
    expect(d.activite_id).toBe('ACT-B');
    expect(d.updated_at).toBe('2026-07-08T10:00:00Z');
    // statut et justif intacts
    expect(d.statut).toBe('a_traiter');
    const justif = await testDb.prepare('SELECT entity_id FROM justificatifs WHERE id = ?').get<{ entity_id: string }>('JUS-1');
    expect(justif?.entity_id).toBe('DEP-1');
  });

  it('normalise les champs vides en NULL (ids et description)', async () => {
    await insertDepot(testDb);

    await updateDepot({ groupId: 'g' }, 'DEP-1', {
      titre: 'Titre corrigé',
      description: '',
      category_id: '',
      unite_id: '',
      amount_cents: null,
      date_estimee: '',
      carte_id: '',
      activite_id: '',
    });

    const d = await readDepot(testDb);
    expect(d.description).toBeNull();
    expect(d.category_id).toBeNull();
    expect(d.unite_id).toBeNull();
    expect(d.amount_cents).toBeNull();
    expect(d.date_estimee).toBeNull();
    expect(d.carte_id).toBeNull();
    expect(d.activite_id).toBeNull();
  });

  it('refuse d’éditer un dépôt déjà rattaché (statut ≠ a_traiter) et ne modifie rien', async () => {
    await insertDepot(testDb, { statut: 'rattache', ecriture_id: 'ECR-1' });

    await expect(
      updateDepot({ groupId: 'g' }, 'DEP-1', { titre: 'ne devrait pas passer' }),
    ).rejects.toThrow();

    const d = await readDepot(testDb);
    expect(d.titre).toBe('Titre initial');
    expect(d.ecriture_id).toBe('ECR-1');
  });

  it('lève une erreur si le dépôt est introuvable', async () => {
    await expect(
      updateDepot({ groupId: 'g' }, 'DEP-INEXISTANT', { titre: 'x' }),
    ).rejects.toThrow(/introuvable/);
  });

  it('refuse d’éditer un dépôt d’un autre groupe', async () => {
    await insertDepot(testDb);
    await expect(
      updateDepot({ groupId: 'autre-groupe' }, 'DEP-1', { titre: 'x' }),
    ).rejects.toThrow(/introuvable/);
  });
});
