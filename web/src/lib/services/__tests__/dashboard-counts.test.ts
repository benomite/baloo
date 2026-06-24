import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';
import {
  countDepotsATraiter,
  countAbandonsATraiter,
  countDraftsBancaires,
} from '../dashboard-counts';

const SETUP_SQL = `
  CREATE TABLE depots_justificatifs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'a_traiter'
  );
  CREATE TABLE abandons_frais (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'a_traiter'
  );
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    ligne_bancaire_id INTEGER
  );
`;

async function setupDb() {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('dashboard-counts', () => {
  let db: Awaited<ReturnType<typeof setupDb>>;

  beforeEach(async () => {
    db = await setupDb();
  });

  it('countDepotsATraiter ne compte que les statuts a_traiter du groupe', async () => {
    await db.prepare("INSERT INTO depots_justificatifs (id, group_id, statut) VALUES (?, ?, ?)").run('d1', 'g1', 'a_traiter');
    await db.prepare("INSERT INTO depots_justificatifs (id, group_id, statut) VALUES (?, ?, ?)").run('d2', 'g1', 'rattache');
    await db.prepare("INSERT INTO depots_justificatifs (id, group_id, statut) VALUES (?, ?, ?)").run('d3', 'g2', 'a_traiter');
    expect(await countDepotsATraiter(db, 'g1')).toBe(1);
  });

  it('countAbandonsATraiter compte a_traiter + valide', async () => {
    await db.prepare("INSERT INTO abandons_frais (id, group_id, status) VALUES (?, ?, ?)").run('a1', 'g1', 'a_traiter');
    await db.prepare("INSERT INTO abandons_frais (id, group_id, status) VALUES (?, ?, ?)").run('a2', 'g1', 'valide');
    await db.prepare("INSERT INTO abandons_frais (id, group_id, status) VALUES (?, ?, ?)").run('a3', 'g1', 'envoye_national');
    expect(await countAbandonsATraiter(db, 'g1')).toBe(2);
  });

  it('countDraftsBancaires ne compte que les drafts liés à une ligne bancaire', async () => {
    await db.prepare("INSERT INTO ecritures (id, group_id, status, ligne_bancaire_id) VALUES (?, ?, ?, ?)").run('e1', 'g1', 'draft', 42);
    await db.prepare("INSERT INTO ecritures (id, group_id, status, ligne_bancaire_id) VALUES (?, ?, ?, ?)").run('e2', 'g1', 'draft', null);
    await db.prepare("INSERT INTO ecritures (id, group_id, status, ligne_bancaire_id) VALUES (?, ?, ?, ?)").run('e3', 'g1', 'mirror', 43);
    expect(await countDraftsBancaires(db, 'g1')).toBe(1);
  });

  it('renvoie 0 sur tables vides', async () => {
    expect(await countDepotsATraiter(db, 'g1')).toBe(0);
    expect(await countAbandonsATraiter(db, 'g1')).toBe(0);
    expect(await countDraftsBancaires(db, 'g1')).toBe(0);
  });
});
