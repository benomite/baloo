// Tests de la migration de réconciliation (spec 2026-06-01) :
// cw_signature, compteurs sync_runs, table cw_link_suggestions, backfill
// comptaweb_ecriture_id depuis cw_numero_piece numérique.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';
import {
  ensureSyncRunsSchema,
  ensureEcrituresCwNumeroPiece,
  ensureReconcileSchema,
} from './business-schema';

type Db = ReturnType<typeof wrapClient>;

async function setupDb(): Promise<{ client: Client; db: Db }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db: wrapClient(client) };
}

// Table ecritures minimale dans sa forme "Phase 1" (sans cw_signature,
// avec cw_numero_piece + comptaweb_ecriture_id) pour tester le backfill.
async function createEcrituresPhase1(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE ecritures (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      date_ecriture TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      type TEXT NOT NULL,
      cw_numero_piece TEXT,
      comptaweb_ecriture_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft'
    );
  `);
}

describe('ensureReconcileSchema', () => {
  let client: Client;
  let db: Db;

  beforeEach(async () => {
    const setup = await setupDb();
    client = setup.client;
    db = setup.db;
    void client;
  });

  it('ajoute la colonne ecritures.cw_signature', async () => {
    await createEcrituresPhase1(db);
    await ensureReconcileSchema(db);
    const cols = await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>();
    expect(cols.some((c) => c.name === 'cw_signature')).toBe(true);
  });

  it('ajoute les compteurs + scope à sync_runs', async () => {
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
    const cols = await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>();
    const names = cols.map((c) => c.name);
    for (const col of [
      'updated_mirror',
      'supprimee_cw_detected',
      'imported_from_cw',
      'link_suggestions_created',
      'detail_fetches',
      'scope',
    ]) {
      expect(names).toContain(col);
    }
  });

  it('crée la table cw_link_suggestions', async () => {
    await ensureReconcileSchema(db);
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cw_link_suggestions'")
      .all<{ name: string }>();
    expect(tables).toHaveLength(1);
  });

  it('est idempotente (deux appels successifs ne plantent pas)', async () => {
    await createEcrituresPhase1(db);
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
    await ensureReconcileSchema(db);
    const cols = await db.prepare('PRAGMA table_info(ecritures)').all<{ name: string }>();
    expect(cols.filter((c) => c.name === 'cw_signature')).toHaveLength(1);
  });

  it('backfill comptaweb_ecriture_id depuis cw_numero_piece numérique', async () => {
    await createEcrituresPhase1(db);
    await db
      .prepare(
        "INSERT INTO ecritures(id,group_id,date_ecriture,description,amount_cents,type,status,cw_numero_piece) VALUES('E1','G','2026-01-01','x',100,'depense','pending_sync','4242')",
      )
      .run();
    await ensureReconcileSchema(db);
    const r = await db
      .prepare("SELECT comptaweb_ecriture_id FROM ecritures WHERE id='E1'")
      .get<{ comptaweb_ecriture_id: number }>();
    expect(r?.comptaweb_ecriture_id).toBe(4242);
  });

  it("n'écrase pas un comptaweb_ecriture_id déjà posé", async () => {
    await createEcrituresPhase1(db);
    await db
      .prepare(
        "INSERT INTO ecritures(id,group_id,date_ecriture,description,amount_cents,type,status,cw_numero_piece,comptaweb_ecriture_id) VALUES('E2','G','2026-01-01','x',100,'depense','mirror','999',111)",
      )
      .run();
    await ensureReconcileSchema(db);
    const r = await db
      .prepare("SELECT comptaweb_ecriture_id FROM ecritures WHERE id='E2'")
      .get<{ comptaweb_ecriture_id: number }>();
    expect(r?.comptaweb_ecriture_id).toBe(111);
  });

  it('ignore les cw_numero_piece non numériques (ECR-2026-1)', async () => {
    await createEcrituresPhase1(db);
    await db
      .prepare(
        "INSERT INTO ecritures(id,group_id,date_ecriture,description,amount_cents,type,status,cw_numero_piece) VALUES('E3','G','2026-01-01','x',100,'depense','mirror','ECR-2026-1')",
      )
      .run();
    await ensureReconcileSchema(db);
    const r = await db
      .prepare("SELECT comptaweb_ecriture_id FROM ecritures WHERE id='E3'")
      .get<{ comptaweb_ecriture_id: number | null }>();
    expect(r?.comptaweb_ecriture_id ?? null).toBeNull();
  });
});
