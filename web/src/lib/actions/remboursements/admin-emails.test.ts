import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { listTresorierEmails } from './_helpers';

// Destinataires des notifications « générales » (nouveau dépôt / remboursement)
// = les TRÉSORIERS actifs du groupe demandé uniquement. Les RG ne sont plus
// notifiés (choix produit 2026-07-04) mais gardent leur accès admin. Isolation
// multi-tenant : jamais les trésoriers d'un autre groupe.
const SETUP_SQL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    email TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'actif',
    role TEXT
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  const insert = (id: string, group: string, email: string, role: string, statut = 'actif') =>
    db
      .prepare('INSERT INTO users (id, group_id, email, role, statut) VALUES (?,?,?,?,?)')
      .run(id, group, email, role, statut);
  // Groupe A
  await insert('a1', 'gA', 'treso-a@x.fr', 'tresorier');
  await insert('a2', 'gA', 'rg-a@x.fr', 'RG');
  await insert('a3', 'gA', 'chef-a@x.fr', 'chef'); // pas admin
  await insert('a4', 'gA', 'ancien-a@x.fr', 'tresorier', 'ancien'); // inactif
  // Groupe B
  await insert('b1', 'gB', 'treso-b@x.fr', 'tresorier');
  await insert('b2', 'gB', 'rg-b@x.fr', 'RG');
  return db;
}

describe('listTresorierEmails', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('ne remonte que les trésoriers actifs du groupe (les RG ne sont plus notifiés)', async () => {
    const emails = await listTresorierEmails('gA', db);
    expect(emails.sort()).toEqual(['treso-a@x.fr']);
  });

  it("n'inclut jamais les trésoriers d'un autre groupe", async () => {
    const emails = await listTresorierEmails('gA', db);
    expect(emails).not.toContain('treso-b@x.fr');
  });

  it('exclut les RG, les chefs et les comptes inactifs', async () => {
    const emails = await listTresorierEmails('gA', db);
    expect(emails).not.toContain('rg-a@x.fr');
    expect(emails).not.toContain('chef-a@x.fr');
    expect(emails).not.toContain('ancien-a@x.fr');
  });

  it('renvoie une liste vide pour un groupe sans trésorier', async () => {
    expect(await listTresorierEmails('gZ', db)).toEqual([]);
  });
});
