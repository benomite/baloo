'use client';

// Hook React pour piloter la sync incrémentale depuis le composant
// header `<SyncStatusButton>`. Pattern client-piloté (cf. spec
// 2026-05-19-baloo-sync-incremental-design.md) :
//
//   1. Mount  → GET /api/sync/status
//   2. Stale  → POST /api/sync/run (auto, sans force)
//   3. Pendant qu'un run est en cours → poll /api/sync/status toutes les 2 s
//   4. Run fini → router.refresh() pour re-render les server components
//      avec les data fraîches
//
// Refetch aussi au retour de focus sur l'onglet (Visibility API) pour
// que l'état reste à jour quand l'user revient après une longue pause.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type ButtonState = 'idle' | 'running' | 'error';

export interface SyncRunRow {
  id: string;
  group_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  trigger: string;
  promoted_to_mirror: number;
  new_drafts: number;
  updated_drafts: number;
  divergent_detected: number;
  error_message: string | null;
  duration_ms: number | null;
}

export interface SyncStatusPayload {
  group_id: string;
  last_run: SyncRunRow | null;
  is_running: boolean;
  stale: boolean;
  throttle_until: string | null;
}

const POLL_INTERVAL_MS = 2000;

export function useSyncStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatusPayload | null>(null);
  const [state, setState] = useState<ButtonState>('idle');
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollHandleRef.current) {
      clearInterval(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (): Promise<SyncStatusPayload | null> => {
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' });
      if (!res.ok) {
        setState('error');
        return null;
      }
      const data = (await res.json()) as SyncStatusPayload;
      setStatus(data);
      // Si on reçoit un is_running depuis le serveur, on s'aligne ;
      // sinon on laisse l'état local (qui peut être 'error').
      if (data.is_running) setState('running');
      else if (state !== 'error') setState('idle');
      return data;
    } catch {
      setState('error');
      return null;
    }
  }, [state]);

  const runSync = useCallback(
    async (force: boolean) => {
      setState('running');
      const url = force ? '/api/sync/run?force=1' : '/api/sync/run';
      try {
        const res = await fetch(url, { method: 'POST' });
        // 429 = throttled / already_running. Pas une erreur : on refetch
        // pour afficher le bon état (un run pourrait être en cours).
        if (res.status === 429) {
          await fetchStatus();
          return;
        }
        if (!res.ok) {
          setState('error');
          return;
        }
        // Le run est lancé. Polling jusqu'à finished.
        clearPoll();
        pollHandleRef.current = setInterval(async () => {
          const s = await fetchStatus();
          if (!s) return;
          if (!s.is_running) {
            clearPoll();
            // Re-render des server components côté Next.
            router.refresh();
          }
        }, POLL_INTERVAL_MS);
      } catch {
        setState('error');
      }
    },
    [fetchStatus, clearPoll, router],
  );

  // Mount : refetch + auto-run si stale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchStatus();
      if (cancelled || !s) return;
      if (s.stale && !s.is_running) {
        await runSync(false);
      } else if (s.is_running) {
        // Un run est en cours côté serveur : on poll jusqu'à finished.
        clearPoll();
        pollHandleRef.current = setInterval(async () => {
          const next = await fetchStatus();
          if (!next?.is_running) {
            clearPoll();
            router.refresh();
          }
        }, POLL_INTERVAL_MS);
      }
    })();
    return () => {
      cancelled = true;
      clearPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch au retour de focus de l'onglet.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) void fetchStatus();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchStatus]);

  return { status, state, runSync };
}
