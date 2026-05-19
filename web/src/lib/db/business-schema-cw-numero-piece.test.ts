// Tests de la migration `cw_numero_piece` (Task 7 du pivot miroir
// strict + MCP-first).
//
// La table `ecritures` historiquement (post-Task 5) :
//   numero_piece TEXT,
//   status TEXT NOT NULL DEFAULT 'draft',
//   ...
//
// On lui ajoute `cw_numero_piece TEXT` (nullable) + index dédié
// `idx_ecritures_cw_numero_piece` qui servira à la sync incrémentale
// (Phase 2) pour matcher `pending_sync` ↔ écriture CW.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';
import { ensureEcrituresCwNumeroPiece } from './business-schema';

// Schéma post-Task 5 mais pré-Task 7 : pas de cw_numero_piece, pas
// d'index dédié. Représente l'état des BDDs déjà migrées au nouvel enum
// statut mais antérieures à Task 7.
const POST_TASK5_PRE_TASK7_SQL = `
  CREATE TABLE ecritures (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    unite_id TEXT,
    date_ecriture TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('depense', 'recette')),
    category_id TEXT,
    mode_paiement_id TEXT,
    activite_id TEXT,
    carte_id TEXT,
    numero_piece TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    justif_attendu INTEGER NOT NULL DEFAULT 1,
    comptaweb_synced INTEGER NOT NULL DEFAULT 0,
    ligne_bancaire_id INTEGER,
    ligne_bancaire_sous_index INTEGER,
    comptaweb_ecriture_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX idx_ecritures_group ON ecritures(group_id);
`;

async function setupPreTask7Db(): Promise<{ client: Client; db: ReturnType<typeof wrapClient> }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.executeMultiple(POST_TASK5_PRE_TASK7_SQL);
  return { client, db: wrapClient(client) };
}

describe('ensureEcrituresCwNumeroPiece', () => {
  let client: Client;
  let db: ReturnType<typeof wrapClient>;

  beforeEach(async () => {
    const setup = await setupPreTask7Db();
    client = setup.client;
    db = setup.db;
  });

  it('ajoute la colonne cw_numero_piece à une table qui ne l a pas', async () => {
    void client;
    const before = await db
      .prepare("PRAGMA table_info(ecritures)")
      .all<{ name: string }>();
    expect(before.some((c) => c.name === 'cw_numero_piece')).toBe(false);

    await ensureEcrituresCwNumeroPiece(db);

    const after = await db
      .prepare("PRAGMA table_info(ecritures)")
      .all<{ name: string }>();
    expect(after.some((c) => c.name === 'cw_numero_piece')).toBe(true);
  });

  it('crée l index idx_ecritures_cw_numero_piece', async () => {
    await ensureEcrituresCwNumeroPiece(db);
    const indexes = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ecritures'",
      )
      .all<{ name: string }>();
    expect(indexes.map((i) => i.name)).toContain('idx_ecritures_cw_numero_piece');
  });

  it('est idempotent : 2e appel ne casse pas', async () => {
    await ensureEcrituresCwNumeroPiece(db);
    await ensureEcrituresCwNumeroPiece(db);
    const cols = await db
      .prepare("PRAGMA table_info(ecritures)")
      .all<{ name: string }>();
    // Une seule colonne `cw_numero_piece`, pas de duplicate.
    expect(cols.filter((c) => c.name === 'cw_numero_piece').length).toBe(1);
  });

  it('la colonne est insérable et nullable', async () => {
    await ensureEcrituresCwNumeroPiece(db);
    // Insert avec valeur explicite.
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type, cw_numero_piece, status)
      VALUES ('e-1', 'g1', '2026-05-18', 'Test', 1000, 'depense', 'CW-001', 'pending_sync');
    `);
    // Insert sans (nullable).
    await db.exec(`
      INSERT INTO ecritures (id, group_id, date_ecriture, description, amount_cents, type)
      VALUES ('e-2', 'g1', '2026-05-18', 'Sans CW', 2000, 'depense');
    `);
    const rows = await db
      .prepare("SELECT id, cw_numero_piece FROM ecritures ORDER BY id")
      .all<{ id: string; cw_numero_piece: string | null }>();
    expect(rows).toEqual([
      { id: 'e-1', cw_numero_piece: 'CW-001' },
      { id: 'e-2', cw_numero_piece: null },
    ]);
  });

  it('no-op silencieux si la table ecritures n existe pas', async () => {
    const c = createClient({ url: 'file::memory:' });
    await c.execute('PRAGMA foreign_keys = OFF');
    const emptyDb = wrapClient(c);
    // Pas de throw.
    await expect(ensureEcrituresCwNumeroPiece(emptyDb)).resolves.toBeUndefined();
  });
});
