'use client';

// Composant client-piloté de la sync incrémentale Comptaweb (Phase 2).
// Monté dans la sidebar (footer) pour les admins uniquement. Mount =
// auto-check status + auto-sync si stale, sans interaction utilisateur.
//
// Clic :
//  - état nominal / stale → force un nouveau sync (override throttle 15 min).
//  - état EXPLICABLE (échec, interruption, erreur réseau) → ouvre une popover
//    de diagnostic (quand + message parlant + action + réessayer + journal)
//    plutôt que de relancer aveuglément. Cf. describe-sync-error.ts.

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Check, AlertTriangle, CircleAlert, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useSyncStatus } from './use-sync-status';
import { describeSyncError, type SyncErrorInput } from './describe-sync-error';

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const lastRun = status?.last_run ?? null;
  const lastFinishedAt = lastRun?.finished_at ?? null;
  const lastFailed = lastRun?.status === 'failed';
  // Run resté bloqué « en cours » alors que plus rien ne tourne (lock 60 s
  // expiré) = interrompu en vol (typiquement timeout Comptaweb / cold start).
  const interrupted = lastRun?.status === 'running' && status?.is_running === false;
  // Erreur réseau côté navigateur (fetch KO) hors run actif.
  const clientError = state === 'error';

  // Y a-t-il quelque chose à EXPLIQUER (→ clic ouvre la popover) ?
  let errorInput: SyncErrorInput | null = null;
  if (clientError) errorInput = { status: 'error-client', errorMessage: lastRun?.error_message ?? null };
  else if (lastFailed) errorInput = { status: 'failed', errorMessage: lastRun?.error_message ?? null };
  else if (interrupted) errorInput = { status: 'running', errorMessage: null };

  let label: string;
  let Icon = Check;
  let extraClasses = 'text-fg-muted';

  if (state === 'running') {
    label = 'Synchronisation…';
    Icon = RefreshCw;
    extraClasses = 'text-brand';
  } else if (clientError || lastFailed) {
    label = 'Échec sync — voir';
    Icon = CircleAlert;
    extraClasses = 'text-danger';
  } else if (interrupted) {
    label = 'Sync interrompue — voir';
    Icon = AlertTriangle;
    extraClasses = 'text-warning';
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

  // Fermeture popover : clic dehors + Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onClick = () => {
    if (errorInput) setOpen((o) => !o);
    else runSync(true);
  };

  const retry = () => {
    setOpen(false);
    runSync(true);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium transition-colors ${
          disabled ? 'cursor-wait opacity-80' : 'hover:bg-fg/[0.05]'
        } ${extraClasses}`}
        title={
          state === 'running'
            ? 'Sync en cours…'
            : errorInput
              ? 'Voir le détail de la sync'
              : 'Cliquer pour forcer la sync Comptaweb (override throttle 15 min)'
        }
        aria-label={label}
        aria-expanded={errorInput ? open : undefined}
      >
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${state === 'running' ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </button>

      {open && errorInput && (
        <SyncErrorPopover
          input={errorInput}
          whenIso={lastRun?.finished_at ?? lastRun?.started_at ?? null}
          rawMessage={lastRun?.error_message ?? null}
          onRetry={retry}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SyncErrorPopover({
  input,
  whenIso,
  rawMessage,
  onRetry,
  onClose,
}: {
  input: SyncErrorInput;
  whenIso: string | null;
  rawMessage: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const info = describeSyncError(input);
  return (
    <div
      role="dialog"
      aria-label="Détail de la synchronisation"
      className="absolute bottom-full left-0 right-0 mb-1.5 z-50 rounded-lg border border-border bg-surface shadow-lg p-3 text-[12px]"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg leading-tight">{info.title}</p>
          {whenIso && <p className="text-[11px] text-fg-muted mt-0.5">{relativeFr(whenIso)}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-fg-muted hover:text-fg -mt-0.5 -mr-0.5 p-0.5"
          aria-label="Fermer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-fg-muted mt-2 leading-snug">{info.advice}</p>

      {info.showRaw && rawMessage && (
        <pre className="mt-2 max-h-24 overflow-auto rounded bg-fg/[0.04] p-2 text-[10.5px] text-fg-muted whitespace-pre-wrap break-words">
          {rawMessage}
        </pre>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {info.action && (
          <Link
            href={info.action.href}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11.5px] font-medium text-brand-fg hover:opacity-90"
            onClick={onClose}
          >
            {info.action.label}
          </Link>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-fg hover:bg-fg/[0.05]"
        >
          <RefreshCw className="h-3 w-3" />
          Réessayer
        </button>
        <Link
          href="/admin/errors"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
        >
          Voir le journal
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
