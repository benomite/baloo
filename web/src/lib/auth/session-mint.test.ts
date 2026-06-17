import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { createDbSession, buildSessionCookie } from './session-mint';

const SETUP_SQL = `
  CREATE TABLE sessions (
    session_token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('session-mint', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('createDbSession insère une ligne sessions valide dans le futur', async () => {
    const { sessionToken, expires } = await createDbSession(db, 'u1');
    expect(sessionToken).toBeTruthy();
    expect(expires.getTime()).toBeGreaterThan(Date.now());
    const row = await db
      .prepare('SELECT user_id, expires FROM sessions WHERE session_token = ?')
      .get<{ user_id: string; expires: string }>(sessionToken);
    expect(row?.user_id).toBe('u1');
    expect(new Date(row!.expires).getTime()).toBeGreaterThan(Date.now());
  });

  it('createDbSession génère des tokens uniques', async () => {
    const a = await createDbSession(db, 'u1');
    const b = await createDbSession(db, 'u1');
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });

  it('buildSessionCookie : nom non-sécurisé en http', () => {
    const exp = new Date(Date.now() + 1000);
    const c = buildSessionCookie('tok', exp, false);
    expect(c.name).toBe('authjs.session-token');
    expect(c.value).toBe('tok');
    expect(c.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
    });
    expect(c.options.expires).toBe(exp);
  });

  it('buildSessionCookie : préfixe __Secure- en https', () => {
    const exp = new Date(Date.now() + 1000);
    const c = buildSessionCookie('tok', exp, true);
    expect(c.name).toBe('__Secure-authjs.session-token');
    expect(c.options.secure).toBe(true);
  });
});
