// Demande terrain 2026-07-24 : un dépôt rattaché à quelque chose (écriture OU
// remboursement) ne doit plus apparaître dans la file « à traiter » de
// /depots. Le statut passe normalement à 'rattache' au rattachement, mais on
// veut une garde DÉFENSIVE : tout dépôt qui porte un lien est exclu de la file
// à traiter même si son statut est resté 'a_traiter' (statut périmé). Couvre
// les 3 appelants de listDepots({statut:'a_traiter'}) : page /depots, bannière
// de match /ecritures, candidats de rattachement (actions/ecritures).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let testDb: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => testDb };
});

import { listDepots } from '../depots';

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
    CREATE TABLE users (id TEXT PRIMARY KEY, nom_affichage TEXT, email TEXT);
    CREATE TABLE unites (id TEXT PRIMARY KEY, code TEXT);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE cartes (id TEXT PRIMARY KEY, porteur TEXT);
    CREATE TABLE justificatifs (id TEXT, entity_type TEXT, entity_id TEXT, file_path TEXT, uploaded_at TEXT);
    INSERT INTO users (id, nom_affichage, email) VALUES ('u1', 'Trésorier', 't@ex.org');
  `);
  const ins = (id: string, statut: string, ecr: string | null, rmb: string | null) =>
    db.prepare(
      `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, statut, ecriture_id, remboursement_id, created_at)
       VALUES (?, 'g', 'u1', ?, ?, ?, ?, '2026-07-01')`,
    ).run(id, `Dépôt ${id}`, statut, ecr, rmb);
  await ins('D-CLEAN', 'a_traiter', null, null);   // vrai à-traiter → visible
  await ins('D-ECR', 'a_traiter', 'ECR-1', null);  // lié écriture, statut périmé → masqué
  await ins('D-RMB', 'a_traiter', null, 'RBT-1');  // lié remboursement, statut périmé → masqué
  await ins('D-RATT', 'rattache', 'ECR-2', null);  // déjà rattache → masqué (statut)
  return db;
}

describe('listDepots — file à traiter exclut les dépôts rattachés', () => {
  beforeEach(async () => { testDb = await setup(); });

  it('ne renvoie que le dépôt à traiter SANS lien', async () => {
    const rows = await listDepots({ groupId: 'g' }, { statut: 'a_traiter' });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('D-CLEAN');
    expect(ids).not.toContain('D-ECR');  // lié à une écriture
    expect(ids).not.toContain('D-RMB');  // lié à un remboursement
    expect(ids).not.toContain('D-RATT'); // statut rattache
    expect(rows).toHaveLength(1);
  });

  it('sans filtre statut, ne filtre pas sur les liens (rétro-compat)', async () => {
    const rows = await listDepots({ groupId: 'g' }, {});
    expect(rows).toHaveLength(4);
  });
});
