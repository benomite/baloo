// #61 : colonnes caisse de `sync_runs` (solde Comptaweb relevé, erreur du pas
// caisse). Nullables, migration idempotente.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';
import { ensureSyncRunsSchema, ensureReconcileSchema } from '../business-schema';

const COLS = ['caisse_solde_cw_cents', 'caisse_error'];

async function colonnes(db: DbWrapper) {
  return (await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>()).map((c) => c.name);
}

describe('sync_runs — colonnes caisse', () => {
  let db: DbWrapper;
  beforeEach(() => {
    db = wrapClient(createClient({ url: 'file::memory:' }));
  });

  it('présentes sur BDD vierge, et la migration y est sans effet', async () => {
    await ensureSyncRunsSchema(db);
    await ensureReconcileSchema(db);
    const cols = await colonnes(db);
    for (const c of COLS) expect(cols.filter((n) => n === c)).toHaveLength(1);
  });

  it('ajoutées sur une table legacy, de façon idempotente', async () => {
    await db.exec(`CREATE TABLE sync_runs (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, trigger TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
    await ensureReconcileSchema(db);
    await ensureReconcileSchema(db);
    const cols = await colonnes(db);
    for (const c of COLS) expect(cols.filter((n) => n === c)).toHaveLength(1);
  });
});
