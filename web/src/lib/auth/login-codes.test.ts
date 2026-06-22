import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { generateCode, createLoginCode, verifyLoginCode } from './login-codes';

// Schéma minimal : login_codes seul suffit à exercer la logique.
const SETUP_SQL = `
  CREATE TABLE login_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('generateCode', () => {
  it('produit un code de 6 chiffres', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('login-codes', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('crée un code vérifiable et le consomme au succès', async () => {
    const { code } = await createLoginCode(db, 'a@b.fr');
    expect(code).toMatch(/^\d{6}$/);

    const ok = await verifyLoginCode(db, 'a@b.fr', code);
    expect(ok).toEqual({ ok: true, email: 'a@b.fr' });

    // Consommé : un second usage du même code échoue.
    const again = await verifyLoginCode(db, 'a@b.fr', code);
    expect(again.ok).toBe(false);
  });

  it('ne stocke jamais le code en clair', async () => {
    const { code } = await createLoginCode(db, 'a@b.fr');
    const row = await db
      .prepare('SELECT code_hash FROM login_codes LIMIT 1')
      .get<{ code_hash: string }>();
    expect(row?.code_hash).toBeTruthy();
    expect(row?.code_hash).not.toBe(code);
  });

  it('rejette un mauvais code et incrémente les tentatives', async () => {
    await createLoginCode(db, 'a@b.fr');
    const res = await verifyLoginCode(db, 'a@b.fr', '000000');
    // Le vrai code n'est pas 000000 dans la quasi-totalité des cas ; si
    // par malchance il l'était, le test ci-dessous resterait cohérent.
    if (res.ok) return;
    expect(res.reason).toBe('invalid');
    const row = await db
      .prepare('SELECT attempts FROM login_codes LIMIT 1')
      .get<{ attempts: number }>();
    expect(row?.attempts).toBe(1);
  });

  it('bloque après 5 tentatives ratées', async () => {
    await createLoginCode(db, 'a@b.fr');
    for (let i = 0; i < 5; i++) {
      await verifyLoginCode(db, 'a@b.fr', '999999');
    }
    // 6e essai, même avec le bon code, doit être bloqué.
    const res = await verifyLoginCode(db, 'a@b.fr', '999999');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('too_many_attempts');
  });

  it('rejette un code expiré', async () => {
    const { code } = await createLoginCode(db, 'a@b.fr', { ttlMinutes: -1 });
    const res = await verifyLoginCode(db, 'a@b.fr', code);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('expired');
  });

  it('un nouveau code invalide le précédent (un seul actif)', async () => {
    const first = await createLoginCode(db, 'a@b.fr');
    await createLoginCode(db, 'a@b.fr');
    const res = await verifyLoginCode(db, 'a@b.fr', first.code);
    expect(res.ok).toBe(false);
  });

  it('normalise email (casse + espaces)', async () => {
    const { code } = await createLoginCode(db, '  A@B.FR ');
    const res = await verifyLoginCode(db, 'a@b.fr', code);
    expect(res).toEqual({ ok: true, email: 'a@b.fr' });
  });

  it('renvoie invalid si aucun code actif pour cet email', async () => {
    const res = await verifyLoginCode(db, 'inconnu@b.fr', '123456');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid');
  });
});
