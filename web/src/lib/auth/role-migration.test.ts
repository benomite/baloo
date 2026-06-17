import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateLegacyRolesToMembre } from './schema';

const SETUP_SQL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    updated_at TEXT
  );
  INSERT INTO users (id, role) VALUES
    ('u1','equipier'),
    ('u2','parent'),
    ('u3','chef'),
    ('u4','tresorier'),
    ('u5','RG'),
    ('u6','membre');
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('migrateLegacyRolesToMembre', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('convertit equipier et parent en membre, laisse les autres intacts', async () => {
    await migrateLegacyRolesToMembre(db);
    const rows = await db
      .prepare('SELECT id, role FROM users ORDER BY id')
      .all<{ id: string; role: string }>();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.role]));
    expect(byId).toEqual({
      u1: 'membre',
      u2: 'membre',
      u3: 'chef',
      u4: 'tresorier',
      u5: 'RG',
      u6: 'membre',
    });
  });

  it('est idempotent (2e passage ne change rien)', async () => {
    await migrateLegacyRolesToMembre(db);
    await migrateLegacyRolesToMembre(db);
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role IN ('equipier','parent')")
      .get<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
