// Tests sentinelles des tools MCP sync_run + sync_status (Phase 2 Task 5).
//
// Convention : on ne re-teste pas la logique de runSyncCycle / getSyncStatus
// (déjà couverte par sync-cycle.test.ts) — seulement la surface MCP :
// noms exposés, schémas, routage du retour.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerSyncTools, withSyncFresh } from '../sync';

vi.mock('@/lib/services/sync-cycle', () => ({
  runSyncCycle: vi.fn(async () => ({
    sync_run_id: 'SYNC-2026-001',
    status: 'ok',
    promoted_to_mirror: 2,
    new_drafts: 1,
    updated_drafts: 0,
    divergent_detected: 0,
    duration_ms: 1234,
  })),
  getSyncStatus: vi.fn(async () => ({
    group_id: 'g-test',
    last_run: null,
    is_running: false,
    stale: true,
    throttle_until: null,
  })),
  ensureSyncFresh: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({} as never)),
}));

describe('sync MCP tools (Phase 2 Task 5)', () => {
  const tools = captureTools(registerSyncTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 2 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual(['sync_run', 'sync_status']);
  });

  it('sync_run accepte un schema avec force optionnel', () => {
    expect(tools.sync_run.schema).toHaveProperty('force');
  });

  it('sync_run retourne le SyncCycleResult sérialisé', async () => {
    const r = await tools.sync_run.handler({});
    const parsed = parseToolResult(r) as { status: string; promoted_to_mirror: number };
    expect(parsed.status).toBe('ok');
    expect(parsed.promoted_to_mirror).toBe(2);
  });

  it('sync_run propage force=true au service', async () => {
    const mod = await import('@/lib/services/sync-cycle');
    await tools.sync_run.handler({ force: true });
    expect(mod.runSyncCycle).toHaveBeenCalledWith(
      expect.anything(),
      'g-test',
      expect.objectContaining({ trigger: 'mcp', force: true }),
    );
  });

  it('sync_run par défaut envoie force=false', async () => {
    const mod = await import('@/lib/services/sync-cycle');
    await tools.sync_run.handler({});
    expect(mod.runSyncCycle).toHaveBeenCalledWith(
      expect.anything(),
      'g-test',
      expect.objectContaining({ trigger: 'mcp', force: false }),
    );
  });

  it('sync_run transmet scope (défaut recent)', async () => {
    const mod = await import('@/lib/services/sync-cycle');
    await tools.sync_run.handler({});
    expect(mod.runSyncCycle).toHaveBeenCalledWith(
      expect.anything(),
      'g-test',
      expect.objectContaining({ scope: 'recent' }),
    );
    await tools.sync_run.handler({ scope: 'exercice' });
    expect(mod.runSyncCycle).toHaveBeenCalledWith(
      expect.anything(),
      'g-test',
      expect.objectContaining({ scope: 'exercice' }),
    );
  });

  it('sync_run marque isError quand status=failed', async () => {
    const mod = await import('@/lib/services/sync-cycle');
    vi.mocked(mod.runSyncCycle).mockResolvedValueOnce({
      sync_run_id: 'SYNC-2026-002',
      status: 'failed',
      promoted_to_mirror: 0,
      new_drafts: 0,
      updated_drafts: 0,
      divergent_detected: 0,
      updated_mirror: 0,
      supprimee_cw_detected: 0,
      imported_from_cw: 0,
      link_suggestions_created: 0,
      detail_fetches: 0,
      scope: 'recent',
      duration_ms: 0,
      error_message: 'CW down',
    });
    const r = (await tools.sync_run.handler({})) as { isError?: boolean };
    expect(r.isError).toBe(true);
  });

  it('sync_status retourne le statut sérialisé', async () => {
    const r = await tools.sync_status.handler();
    const parsed = parseToolResult(r) as { stale: boolean; group_id: string };
    expect(parsed.stale).toBe(true);
    expect(parsed.group_id).toBe('g-test');
  });
});

describe('withSyncFresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appelle ensureSyncFresh puis exécute fn', async () => {
    const mod = await import('@/lib/services/sync-cycle');
    const fn = vi.fn(async () => 'result');
    const out = await withSyncFresh('g-test', fn);
    expect(out).toBe('result');
    expect(mod.ensureSyncFresh).toHaveBeenCalledWith(
      expect.anything(),
      'g-test',
      'mcp',
    );
    expect(fn).toHaveBeenCalled();
  });

  it("ne masque pas l'exception levée par fn", async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(withSyncFresh('g-test', fn)).rejects.toThrow('boom');
  });
});
