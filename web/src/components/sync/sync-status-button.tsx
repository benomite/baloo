'use client';

// Composant client-piloté de la sync incrémentale Comptaweb (Phase 2).
// Monté dans la sidebar (footer) pour les admins uniquement. Mount =
// auto-check status + auto-sync si stale, sans interaction utilisateur.
// Le clic force un nouveau sync (override throttle 15 min, pas le
// verrou running).

import { RefreshCw, Check, AlertTriangle, CircleAlert } from 'lucide-react';
import { useSyncStatus } from './use-sync-status';

function relativeFr(iso: string | null | undefined): string {
  if (!iso) return 'jamais';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'date ?';
  const diff = Date.now() - ts;
  if (diff < 30_000) return "à l'instant";
  if (diff < 60_000) return 'il y a quelques secondes';
  const min = Math.round(diff / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(diff / 86_400_000);
  return `il y a ${d} j`;
}

export function SyncStatusButton() {
  const { status, state, runSync } = useSyncStatus();

  const lastFinishedAt = status?.last_run?.finished_at ?? null;
  const lastFailed = status?.last_run?.status === 'failed';

  let label: string;
  let Icon = Check;
  let extraClasses = 'text-fg-muted';

  if (state === 'running') {
    label = 'Synchronisation…';
    Icon = RefreshCw;
    extraClasses = 'text-brand';
  } else if (state === 'error' || lastFailed) {
    label = 'Échec sync — réessayer';
    Icon = CircleAlert;
    extraClasses = 'text-danger';
  } else if (status?.stale) {
    label = `Sync ${relativeFr(lastFinishedAt)} — actualiser`;
    Icon = AlertTriangle;
    extraClasses = 'text-warning';
  } else if (lastFinishedAt) {
    label = `Synced ${relativeFr(lastFinishedAt)}`;
    Icon = Check;
    extraClasses = 'text-fg-muted';
  } else {
    label = 'Sync à lancer';
    Icon = AlertTriangle;
    extraClasses = 'text-warning';
  }

  const disabled = state === 'running';

  return (
    <button
      type="button"
      onClick={() => runSync(true)}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium transition-colors ${
        disabled ? 'cursor-wait opacity-80' : 'hover:bg-fg/[0.05]'
      } ${extraClasses}`}
      title={
        state === 'running'
          ? 'Sync en cours…'
          : status?.last_run?.error_message
            ? `Avertissement : ${status.last_run.error_message}`
            : 'Cliquer pour forcer la sync Comptaweb (override throttle 15 min)'
      }
      aria-label={label}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${state === 'running' ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </button>
  );
}
