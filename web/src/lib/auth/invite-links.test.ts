import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import {
  generateInviteLink,
  resolveInviteLink,
  markUserConnected,
  buildInviteUrl,
} from './invite-links';

// Schéma minimal : users + invite_links (les FK suffisent à exercer la logique).
const SETUP_SQL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    email TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'actif',
    email_verified TEXT,
    updated_at TEXT
  );
  CREATE TABLE invite_links (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    callback_url TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    revoked_at TEXT
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(SETUP_SQL);
  const db = wrapClient(client);
  await db
    .prepare("INSERT INTO users (id, group_id, email, statut) VALUES ('u1','g1','a@b.fr','actif')")
    .run();
  return db;
}

describe('invite-links', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('génère un lien résolvable vers le bon user', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
      createdBy: 'admin1',
    });
    expect(rawToken).toMatch(/^inv_/);
    const resolved = await resolveInviteLink(db, rawToken);
    expect(resolved).toEqual({
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
  });

  it('ne stocke jamais le token en clair', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    const row = await db
      .prepare('SELECT token_hash FROM invite_links LIMIT 1')
      .get<{ token_hash: string }>();
    expect(row?.token_hash).toBeTruthy();
    expect(row?.token_hash).not.toBe(rawToken);
  });

  it('résout null pour un token inconnu', async () => {
    expect(await resolveInviteLink(db, 'inv_inexistant')).toBeNull();
  });

  it('résout null pour un lien expiré', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
      ttlDays: -1, // déjà expiré
    });
    expect(await resolveInviteLink(db, rawToken)).toBeNull();
  });

  it('résout null pour un lien révoqué (régénération)', async () => {
    const first = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    // Régénérer révoque le précédent (un seul lien actif par user).
    await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    expect(await resolveInviteLink(db, first.rawToken)).toBeNull();
  });

  it('résout null si le user est désactivé', async () => {
    const { rawToken } = await generateInviteLink(db, {
      userId: 'u1',
      groupId: 'g1',
      callbackUrl: '/remboursements/nouveau',
    });
    await db.prepare("UPDATE users SET statut='ancien' WHERE id='u1'").run();
    expect(await resolveInviteLink(db, rawToken)).toBeNull();
  });

  it('markUserConnected remplit email_verified seulement si null', async () => {
    await markUserConnected(db, 'u1');
    const row1 = await db
      .prepare("SELECT email_verified FROM users WHERE id='u1'")
      .get<{ email_verified: string | null }>();
    expect(row1?.email_verified).toBeTruthy();
    const firstValue = row1!.email_verified;
    await markUserConnected(db, 'u1'); // ne doit pas écraser
    const row2 = await db
      .prepare("SELECT email_verified FROM users WHERE id='u1'")
      .get<{ email_verified: string | null }>();
    expect(row2?.email_verified).toBe(firstValue);
  });

  it('buildInviteUrl assemble appUrl + /i/token sans double slash', () => {
    expect(buildInviteUrl('https://baloo.test/', 'inv_abc')).toBe(
      'https://baloo.test/i/inv_abc',
    );
    expect(buildInviteUrl('https://baloo.test', 'inv_abc')).toBe(
      'https://baloo.test/i/inv_abc',
    );
  });
});
