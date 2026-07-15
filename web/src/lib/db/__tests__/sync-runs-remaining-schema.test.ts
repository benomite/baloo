// Task 2 : colonne `sync_runs.remaining` (nullable, migration idempotente).
// Reste-à-traiter d'un cycle de sync (spec 2026-07-15) : nombre de
// ventilations/écritures à traiter dans ce run. Nullable volontairement
// (vieux runs = NULL = inconnu, PAS 0). Pas de backfill, pas d'index.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient, type DbWrapper } from '../../db';

let db: DbWrapper;

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>();
  return { ...actual, getDb: () => db };
});

import { ensureSyncRunsSchema, ensureReconcileSchema } from '../business-schema';

describe('sync_runs.remaining', () => {
  beforeEach(() => {
    const client = createClient({ url: 'file::memory:' });
    db = wrapClient(client);
  });

  it('est présente après ensureSyncRunsSchema (BDD vierge)', async () => {
    await ensureSyncRunsSchema(db);
    const cols = await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>();
    expect(cols.some((c) => c.name === 'remaining')).toBe(true);
  });

  it('est ajoutée par ensureReconcileSchema sur une table legacy sans la colonne', async () => {
    // table legacy SANS remaining
    await db.exec(`CREATE TABLE sync_runs (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, trigger TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
    await ensureReconcileSchema(db);
    const cols = await db.prepare('PRAGMA table_info(sync_runs)').all<{ name: string }>();
    expect(cols.some((c) => c.name === 'remaining')).toBe(true);
  });
});
