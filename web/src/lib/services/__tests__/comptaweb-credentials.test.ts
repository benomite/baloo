import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';

let testDb: ReturnType<typeof wrapClient>;
vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return {
    ...actual,
    getDb: () => testDb,
  };
});

import {
  ensureComptawebCredentialsSchema,
  getComptawebCredentials,
  saveComptawebCredentials,
  getComptawebCredentialsStatus,
  resolveComptawebCredentials,
} from '../comptaweb-credentials';

beforeAll(() => {
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
});

beforeEach(async () => {
  const client = createClient({ url: 'file::memory:' });
  testDb = wrapClient(client);
  await ensureComptawebCredentialsSchema();
  delete process.env.COMPTAWEB_USERNAME;
  delete process.env.COMPTAWEB_PASSWORD;
});

describe('comptaweb-credentials', () => {
  it('save puis get : roundtrip du mot de passe (déchiffré)', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'treso@x.fr', password: 'secret123' });
    const got = await getComptawebCredentials();
    expect(got).toEqual({ username: 'treso@x.fr', password: 'secret123', base_url: null });
  });

  it('le password n\'est pas stocké en clair', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'a', password: 'secret123' });
    const row = await testDb.prepare('SELECT password_encrypted FROM comptaweb_credentials').get<{ password_encrypted: string }>();
    expect(row?.password_encrypted).not.toContain('secret123');
  });

  it('save sans password ne touche pas au password existant', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'a', password: 'pw1' });
    await saveComptawebCredentials('g1', 'u1', { username: 'b' }); // pas de password
    const got = await getComptawebCredentials();
    expect(got?.username).toBe('b');
    expect(got?.password).toBe('pw1');
  });

  it('status ne révèle pas le password', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'treso@x.fr', password: 'pw' });
    const st = await getComptawebCredentialsStatus();
    expect(st.configured).toBe(true);
    expect(st.username).toBe('treso@x.fr');
    expect(JSON.stringify(st)).not.toContain('pw');
  });

  it('getComptawebCredentials throw si plusieurs lignes (garde-fou multi-groupe)', async () => {
    await saveComptawebCredentials('g1', 'u1', { username: 'a', password: 'p' });
    await saveComptawebCredentials('g2', 'u2', { username: 'b', password: 'p' });
    await expect(getComptawebCredentials()).rejects.toThrow();
  });

  it('resolve : BDD prioritaire', async () => {
    process.env.COMPTAWEB_USERNAME = 'env-user';
    process.env.COMPTAWEB_PASSWORD = 'env-pw';
    await saveComptawebCredentials('g1', 'u1', { username: 'bdd-user', password: 'bdd-pw' });
    expect(await resolveComptawebCredentials()).toMatchObject({ username: 'bdd-user', password: 'bdd-pw' });
  });

  it('resolve : repli sur env si pas de credentials BDD', async () => {
    process.env.COMPTAWEB_USERNAME = 'env-user';
    process.env.COMPTAWEB_PASSWORD = 'env-pw';
    expect(await resolveComptawebCredentials()).toMatchObject({ username: 'env-user', password: 'env-pw' });
  });

  it('resolve : null si ni BDD ni env', async () => {
    expect(await resolveComptawebCredentials()).toBeNull();
  });
});
