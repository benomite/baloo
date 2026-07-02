// Demande terrain 2026-07-02 : quand on rattache un dépôt à une écriture dont
// le titre n'a PAS encore été renseigné (encore le libellé bancaire brut,
// affiché grisé = `titre_a_renommer`), l'écriture doit hériter du `titre` du
// dépôt. On ne touche jamais un titre déjà renommé, ni une écriture déjà dans
// Comptaweb, et `libelle_origine` (clé de rapprochement) reste intact.

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
  currentTimestamp: () => '2026-07-02T10:00:00Z',
}));

import { attachDepotToEcriture } from '../depots';

async function setup(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE depots_justificatifs (
      id TEXT PRIMARY KEY, group_id TEXT, submitted_by_user_id TEXT, titre TEXT NOT NULL,
      description TEXT, category_id TEXT, unite_id TEXT, amount_cents INTEGER,
      date_estimee TEXT, carte_id TEXT, activite_id TEXT, statut TEXT NOT NULL DEFAULT 'a_traiter',
      ecriture_id TEXT, motif_rejet TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT, date_ecriture TEXT, description TEXT,
      libelle_origine TEXT, amount_cents INTEGER, type TEXT, status TEXT,
      category_id TEXT, unite_id TEXT, carte_id TEXT, activite_id TEXT, updated_at TEXT
    );
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT);
  `);
  return db;
}

async function insertDepot(db: DbWrapper, titre: string) {
  await db
    .prepare(
      `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, statut)
       VALUES ('DEP-1', 'g', 'u1', ?, 'a_traiter')`,
    )
    .run(titre);
}

async function insertEcriture(
  db: DbWrapper,
  o: { description: string; libelleOrigine: string | null; status: string },
) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, libelle_origine, amount_cents, type, status)
       VALUES ('ECR-1', 'g', '2026-06-23', ?, ?, 4500, 'depense', ?)`,
    )
    .run(o.description, o.libelleOrigine, o.status);
}

async function readDescription(db: DbWrapper): Promise<{ description: string; libelle_origine: string | null }> {
  const r = await db
    .prepare('SELECT description, libelle_origine FROM ecritures WHERE id = ?')
    .get<{ description: string; libelle_origine: string | null }>('ECR-1');
  return r!;
}

const RAW = 'AUCHANSUPERMAR4727409';

describe('attachDepotToEcriture — héritage du titre du dépôt', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('un draft au titre brut hérite du titre du dépôt (libelle_origine préservé)', async () => {
    await insertDepot(testDb, 'Courses intendance camp');
    await insertEcriture(testDb, { description: RAW, libelleOrigine: RAW, status: 'draft' });

    await attachDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-1');

    const e = await readDescription(testDb);
    expect(e.description).toBe('Courses intendance camp');
    expect(e.libelle_origine).toBe(RAW); // clé de rapprochement intacte
  });

  it('ne touche PAS un draft dont le titre a déjà été renommé', async () => {
    await insertDepot(testDb, 'Courses intendance camp');
    await insertEcriture(testDb, { description: 'Mon titre à moi', libelleOrigine: RAW, status: 'draft' });

    await attachDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-1');

    expect((await readDescription(testDb)).description).toBe('Mon titre à moi');
  });

  it('ne touche PAS une écriture déjà dans Comptaweb (mirror)', async () => {
    await insertDepot(testDb, 'Courses intendance camp');
    await insertEcriture(testDb, { description: RAW, libelleOrigine: RAW, status: 'mirror' });

    await attachDepotToEcriture({ groupId: 'g' }, 'DEP-1', 'ECR-1');

    expect((await readDescription(testDb)).description).toBe(RAW);
  });
});
