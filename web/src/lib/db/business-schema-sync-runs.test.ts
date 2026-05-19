// Tests de la création de la table `sync_runs` (Task 1 Phase 2 du pivot
// miroir strict + MCP-first).
//
// La table `sync_runs` est nouvelle (pas de migration depuis un schéma
// historique) — chaque ligne trace un cycle de sync incrémental
// Comptaweb. Statuts portés côté code : 'running' / 'ok' / 'failed' /
// 'skipped'. Pas de CHECK SQL (cf. AGENTS.md).
//
// Cf. doc/specs/2026-05-19-baloo-sync-incremental-design.md.

import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { wrapClient } from '../db';
import { ensureSyncRunsSchema } from './business-schema';

async function setupEmptyDb(): Promise<{ client: Client; db: ReturnType<typeof wrapClient> }> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db: wrapClient(client) };
}

describe('ensureSyncRunsSchema', () => {
  let client: Client;
  let db: ReturnType<typeof wrapClient>;

  beforeEach(async () => {
    const setup = await setupEmptyDb();
    client = setup.client;
    db = setup.db;
  });

  it('crée la table sync_runs', async () => {
    void client;
    await ensureSyncRunsSchema(db);
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_runs'")
      .all<{ name: string }>();
    expect(tables).toHaveLength(1);
  });

  it('crée l index idx_sync_runs_group_started', async () => {
    await ensureSyncRunsSchema(db);
    const idx = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sync_runs_group_started'",
      )
      .all<{ name: string }>();
    expect(idx).toHaveLength(1);
  });

  it('expose les colonnes attendues avec les bons types/nullabilités', async () => {
    await ensureSyncRunsSchema(db);
    const cols = await db
      .prepare("PRAGMA table_info(sync_runs)")
      .all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>();
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    // SQLite PRAGMA renvoie notnull=0 pour TEXT PRIMARY KEY sans NOT NULL
    // explicite ; le PK garantit la non-nullité au runtime.
    expect(byName.id).toMatchObject({ type: 'TEXT', pk: 1 });
    expect(byName.group_id).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.started_at).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.finished_at).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(byName.status).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.trigger).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(byName.promoted_to_mirror).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(byName.new_drafts).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(byName.updated_drafts).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(byName.divergent_detected).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(byName.error_message).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(byName.duration_ms).toMatchObject({ type: 'INTEGER', notnull: 0 });
    expect(byName.created_at).toMatchObject({ type: 'TEXT', notnull: 1 });
  });

  it('est idempotent : 2e appel ne casse pas et ne duplique pas l index', async () => {
    await ensureSyncRunsSchema(db);
    await ensureSyncRunsSchema(db);
    const idx = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sync_runs_group_started'",
      )
      .all<{ name: string }>();
    expect(idx).toHaveLength(1);
  });

  it('accepte un INSERT minimal (status, trigger, started_at, group_id, id, created_at)', async () => {
    await ensureSyncRunsSchema(db);
    await db
      .prepare(
        `INSERT INTO sync_runs (id, group_id, started_at, status, trigger, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('sync_1', 'g1', '2026-05-19T12:00:00Z', 'running', 'client', '2026-05-19T12:00:00Z');

    const rows = await db
      .prepare('SELECT id, status, trigger, promoted_to_mirror FROM sync_runs')
      .all<{ id: string; status: string; trigger: string; promoted_to_mirror: number }>();
    expect(rows).toEqual([
      { id: 'sync_1', status: 'running', trigger: 'client', promoted_to_mirror: 0 },
    ]);
  });

  it('autorise un status arbitraire (pas de CHECK SQL)', async () => {
    // Garde-fou : si quelqu'un ajoute un CHECK SQL en pensant aider, ce
    // test plante. La validation des statuts vit côté code (cf. AGENTS.md).
    await ensureSyncRunsSchema(db);
    await db
      .prepare(
        `INSERT INTO sync_runs (id, group_id, started_at, status, trigger, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('sync_x', 'g1', '2026-05-19T12:00:00Z', 'invented_status', 'invented_trigger', '2026-05-19T12:00:00Z');

    const row = await db
      .prepare('SELECT status, trigger FROM sync_runs WHERE id = ?')
      .get<{ status: string; trigger: string }>('sync_x');
    expect(row).toEqual({ status: 'invented_status', trigger: 'invented_trigger' });
  });

  it('isole les runs par group_id via le query pattern attendu', async () => {
    await ensureSyncRunsSchema(db);
    await db
      .prepare(
        `INSERT INTO sync_runs (id, group_id, started_at, status, trigger, created_at)
         VALUES ('s_a1', 'g_a', '2026-05-19T12:00:00Z', 'ok', 'client', '2026-05-19T12:00:00Z'),
                ('s_a2', 'g_a', '2026-05-19T12:05:00Z', 'ok', 'mcp', '2026-05-19T12:05:00Z'),
                ('s_b1', 'g_b', '2026-05-19T12:03:00Z', 'ok', 'client', '2026-05-19T12:03:00Z')`,
      )
      .run();

    // Query type "dernier sync du groupe A" : sert au throttle.
    const lastA = await db
      .prepare(
        'SELECT id FROM sync_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT 1',
      )
      .get<{ id: string }>('g_a');
    expect(lastA?.id).toBe('s_a2');

    const lastB = await db
      .prepare(
        'SELECT id FROM sync_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT 1',
      )
      .get<{ id: string }>('g_b');
    expect(lastB?.id).toBe('s_b1');
  });
});
