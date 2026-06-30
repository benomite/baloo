// Tests de la migration « recettes sans justif attendu » (demande terrain
// 2026-06-30) : une entrée d'argent n'attend pas de justificatif. On repasse
// justif_attendu=0 sur les recettes encore à 1, SAUF celles avec un justif
// réellement attaché.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';
import { ensureRecettesSansJustifAttendu } from './business-schema';

type Db = ReturnType<typeof wrapClient>;

async function setupDb(): Promise<Db> {
  const client: Client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  const db = wrapClient(client);
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, date_ecriture TEXT NOT NULL,
      description TEXT NOT NULL, amount_cents INTEGER NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', justif_attendu INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE justificatifs (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT);
  `);
  return db;
}

async function insert(db: Db, o: { id: string; type: string; justif: number }) {
  await db
    .prepare(
      `INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, justif_attendu)
       VALUES (?, 'g', '2026-06-23', 'x', 4500, ?, ?)`,
    )
    .run(o.id, o.type, o.justif);
}

async function justif(db: Db, id: string): Promise<number> {
  const r = await db.prepare('SELECT justif_attendu FROM ecritures WHERE id = ?').get<{ justif_attendu: number }>(id);
  return r!.justif_attendu;
}

describe('ensureRecettesSansJustifAttendu', () => {
  let db: Db;
  beforeEach(async () => { db = await setupDb(); });

  it('repasse une recette sans justif à justif_attendu=0', async () => {
    await insert(db, { id: 'R1', type: 'recette', justif: 1 });
    await ensureRecettesSansJustifAttendu(db);
    expect(await justif(db, 'R1')).toBe(0);
  });

  it('épargne une recette qui a un justif attaché', async () => {
    await insert(db, { id: 'R2', type: 'recette', justif: 1 });
    await db.prepare("INSERT INTO justificatifs (id, entity_type, entity_id) VALUES ('J1', 'ecriture', 'R2')").run();
    await ensureRecettesSansJustifAttendu(db);
    expect(await justif(db, 'R2')).toBe(1);
  });

  it('ne touche pas les dépenses', async () => {
    await insert(db, { id: 'D1', type: 'depense', justif: 1 });
    await ensureRecettesSansJustifAttendu(db);
    expect(await justif(db, 'D1')).toBe(1);
  });

  it('idempotente (2e passage = no-op)', async () => {
    await insert(db, { id: 'R3', type: 'recette', justif: 1 });
    await ensureRecettesSansJustifAttendu(db);
    await ensureRecettesSansJustifAttendu(db);
    expect(await justif(db, 'R3')).toBe(0);
  });
});
