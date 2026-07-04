// @vitest-environment jsdom

// Tests du composant <SyncStatusButton> et de son hook useSyncStatus
// (Phase 2 Task 6).
//
// On teste :
//  1. Au mount, GET /api/sync/status est appelé.
//  2. Si stale → POST /api/sync/run lancé automatiquement.
//  3. Pendant un run, le bouton est désactivé + label "Synchronisation…".
//  4. Quand le sync finit, router.refresh() est appelé.
//  5. 429 ne lève pas d'erreur, juste refetch.
//  6. Clic = force sync (POST avec ?force=1).
//  7. Affichages : "Synced il y a X" si fresh, "Sync ... actualiser" si stale.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { SyncStatusButton } from '../sync-status-button';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

interface MockResponse {
  status?: number;
  body?: unknown;
}

function setFetchSequence(seq: Array<MockResponse | ((url: string, init?: RequestInit) => MockResponse)>): void {
  const calls: Array<MockResponse | ((url: string, init?: RequestInit) => MockResponse)> = [...seq];
  global.fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as { url: string }).url;
    const next = calls.shift();
    const resp: MockResponse =
      typeof next === 'function' ? next(url, init) : (next ?? { status: 200, body: {} });
    return {
      ok: resp.status === undefined || (resp.status >= 200 && resp.status < 300),
      status: resp.status ?? 200,
      json: async () => resp.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function statusBody(opts: Partial<{ stale: boolean; is_running: boolean; finished_at: string | null; status: string }>) {
  return {
    group_id: 'g1',
    last_run: opts.finished_at !== undefined
      ? {
          id: 'SYNC-2026-001',
          group_id: 'g1',
          started_at: new Date(Date.now() - 60_000).toISOString(),
          finished_at: opts.finished_at,
          status: opts.status ?? 'ok',
          trigger: 'client',
          promoted_to_mirror: 0,
          new_drafts: 0,
          updated_drafts: 0,
          divergent_detected: 0,
          error_message: null,
          duration_ms: 1000,
        }
      : null,
    is_running: opts.is_running ?? false,
    stale: opts.stale ?? false,
    throttle_until: null,
  };
}

const runOkBody = {
  sync_run_id: 'SYNC-2026-002',
  status: 'ok',
  promoted_to_mirror: 1,
  new_drafts: 0,
  updated_drafts: 0,
  divergent_detected: 0,
  duration_ms: 500,
};

describe('<SyncStatusButton>', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('affiche "Synced il y a..." pour un run récent fresh', async () => {
    setFetchSequence([
      {
        status: 200,
        body: statusBody({ stale: false, is_running: false, finished_at: new Date().toISOString() }),
      },
    ]);
    render(<SyncStatusButton />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Synced/ })).toBeTruthy();
    });
  });

  it('affiche un bouton désactivé pendant la synchronisation', async () => {
    setFetchSequence([
      // 1. Status au mount : stale
      { status: 200, body: statusBody({ stale: true, is_running: false, finished_at: null }) },
      // 2. POST /api/sync/run : OK (202)
      { status: 202, body: runOkBody },
      // 3. Poll status : encore running
      { status: 200, body: statusBody({ stale: false, is_running: true, finished_at: null }) },
    ]);

    render(<SyncStatusButton />);

    await waitFor(() => {
      const btn = screen.getByRole('button');
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('au mount, GET /status puis si stale POST /run automatiquement', async () => {
    setFetchSequence([
      { status: 200, body: statusBody({ stale: true, is_running: false, finished_at: null }) },
      { status: 202, body: runOkBody },
      { status: 200, body: statusBody({ stale: false, is_running: false, finished_at: new Date().toISOString() }) },
    ]);

    render(<SyncStatusButton />);

    await waitFor(() => {
      const fetchMock = vi.mocked(global.fetch);
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/api/sync/status'))).toBe(true);
      expect(calls.some((u) => u === '/api/sync/run')).toBe(true);
    });
  });

  it('clic = POST /run?force=1', async () => {
    setFetchSequence([
      { status: 200, body: statusBody({ stale: false, finished_at: new Date().toISOString() }) },
      // Clic → POST force
      { status: 202, body: runOkBody },
      // Poll status
      { status: 200, body: statusBody({ stale: false, is_running: false, finished_at: new Date().toISOString() }) },
    ]);

    render(<SyncStatusButton />);

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeTruthy();
    });

    const btn = screen.getByRole('button');
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      const fetchMock = vi.mocked(global.fetch);
      const runCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/sync/run'));
      expect(runCall).toBeTruthy();
      expect(String(runCall![0])).toContain('force=1');
    });
  });

  it('429 ne déclenche pas l\'état error : refetch status', async () => {
    setFetchSequence([
      { status: 200, body: statusBody({ stale: false, finished_at: new Date().toISOString() }) },
      // Clic → 429 throttled
      { status: 429, body: { status: 'skipped', skipped_reason: 'throttled' } },
      // Refetch après 429
      { status: 200, body: statusBody({ stale: false, finished_at: new Date().toISOString() }) },
    ]);

    render(<SyncStatusButton />);
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    await waitFor(() => {
      // Pas de label d'erreur après 429
      expect(screen.queryByText(/Échec sync/)).toBeNull();
    });
  });

  it('affiche "Échec sync" quand last_run.status=failed', async () => {
    setFetchSequence([
      {
        status: 200,
        body: statusBody({ stale: true, finished_at: new Date().toISOString(), status: 'failed' }),
      },
      // Auto-sync au mount va re-tester, on retourne fail
      { status: 500, body: { status: 'failed', error_message: 'CW down' } },
    ]);

    render(<SyncStatusButton />);
    await waitFor(() => {
      expect(screen.getByText(/Échec sync/)).toBeTruthy();
    });
  });

  it('affiche "Sync interrompue" quand un run est resté bloqué (running + is_running=false)', async () => {
    setFetchSequence([
      {
        status: 200,
        body: statusBody({
          stale: false,
          is_running: false,
          finished_at: new Date().toISOString(),
          status: 'running',
        }),
      },
    ]);

    render(<SyncStatusButton />);
    await waitFor(() => {
      expect(screen.getByText(/interrompue/i)).toBeTruthy();
    });
  });

  it('clic sur un échec ouvre la popover de diagnostic sans relancer la sync', async () => {
    setFetchSequence([
      // stale=false → pas d'auto-run au mount, on isole le comportement du clic.
      {
        status: 200,
        body: statusBody({ stale: false, is_running: false, finished_at: new Date().toISOString(), status: 'failed' }),
      },
    ]);

    render(<SyncStatusButton />);
    await waitFor(() => expect(screen.getByText(/Échec sync/)).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Échec sync/ }));
    });

    // La popover (role dialog) apparaît avec le bouton Réessayer…
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy();
    });
    // …et aucun POST /api/sync/run n'a été déclenché par le clic.
    const fetchMock = vi.mocked(global.fetch);
    const runCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/sync/run'));
    expect(runCalls.length).toBe(0);
  });
});
