import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../db';
import { migrateKmColumns } from './schema';

const SETUP_SQL = `
  CREATE TABLE remboursement_lignes (
    id TEXT PRIMARY KEY,
    remboursement_id TEXT NOT NULL,
    date_depense TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    nature TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature)
    VALUES ('l1','r1','2026-05-09', 3704, 'Courses');
  CREATE TABLE groupes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    nom TEXT NOT NULL
  );
  INSERT INTO groupes (id, code, nom) VALUES ('g1','VDS','Val de Saône');
`;

async function setupDb(): Promise<DbWrapper> {
  const client = createClient({ url: 'file::memory:' });
  await client.executeMultiple(SETUP_SQL);
  return wrapClient(client);
}

describe('migrateKmColumns', () => {
  let db: DbWrapper;
  beforeEach(async () => {
    db = await setupDb();
  });

  it('ajoute les colonnes km aux lignes ; lignes existantes en type depense', async () => {
    await migrateKmColumns(db);
    const row = await db
      .prepare("SELECT type, distance_km_dixiemes, taux_km_millicents FROM remboursement_lignes WHERE id='l1'")
      .get<{ type: string; distance_km_dixiemes: number | null; taux_km_millicents: number | null }>();
    expect(row?.type).toBe('depense');
    expect(row?.distance_km_dixiemes).toBeNull();
    expect(row?.taux_km_millicents).toBeNull();
  });

  it('ajoute taux_km_millicents au groupe avec défaut 354', async () => {
    await migrateKmColumns(db);
    const g = await db
      .prepare("SELECT taux_km_millicents FROM groupes WHERE id='g1'")
      .get<{ taux_km_millicents: number }>();
    expect(g?.taux_km_millicents).toBe(354);
  });

  it('est idempotent', async () => {
    await migrateKmColumns(db);
    await migrateKmColumns(db);
    const g = await db.prepare("SELECT taux_km_millicents FROM groupes WHERE id='g1'").get<{ taux_km_millicents: number }>();
    expect(g?.taux_km_millicents).toBe(354);
  });
});
