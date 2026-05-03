import { CheckCircle2, RotateCcw, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/shared/empty-state';
import { TabLink } from '@/components/shared/tab-link';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import {
  countUnresolvedErrors,
  listErrors,
  type ErrorLogRow,
} from '@/lib/services/errors';
import { resolveError, reopenError } from '@/lib/actions/errors';
import { cn } from '@/lib/utils';

interface SearchParams {
  show?: string;
  resolved?: string;
  reopened?: string;
  group_resolved?: string;
  error?: string;
}

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, sp] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);

  const showAll = sp.show === 'all';
  const [errors, unresolvedCount] = await Promise.all([
    listErrors({ unresolvedOnly: !showAll, limit: 100 }),
    countUnresolvedErrors(),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Journal d'erreurs"
        subtitle="Erreurs serveur capturées par logError() — utile pour repérer ce qui plante en prod sans avoir à creuser les logs Vercel."
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.resolved && (
        <Alert variant="success" className="mb-4">
          Erreur <code className="font-mono text-[12.5px] font-medium">{sp.resolved}</code>{' '}
          marquée résolue.
        </Alert>
      )}
      {sp.reopened && (
        <Alert variant="info" className="mb-4">
          Erreur <code className="font-mono text-[12.5px] font-medium">{sp.reopened}</code>{' '}
          ré-ouverte.
        </Alert>
      )}
      {sp.group_resolved && (
        <Alert variant="success" className="mb-4">
          {sp.group_resolved} erreur{Number(sp.group_resolved) > 1 ? 's' : ''} marquée
          {Number(sp.group_resolved) > 1 ? 's' : ''} résolue
          {Number(sp.group_resolved) > 1 ? 's' : ''}.
        </Alert>
      )}

      <div className="mb-6 flex flex-wrap gap-6 border-b">
        <TabLink href="/admin/errors" active={!showAll}>
          <span className="inline-flex items-center gap-1.5">
            Non résolues
            {unresolvedCount > 0 && (
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full text-[10.5px] font-semibold px-1.5 min-w-[18px] h-[18px]',
                  !showAll
                    ? 'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200'
                    : 'bg-bg-sunken text-fg-muted',
                )}
              >
                {unresolvedCount}
              </span>
            )}
          </span>
        </TabLink>
        <TabLink href="/admin/errors?show=all" active={showAll}>
          Toutes
        </TabLink>
      </div>

      {errors.length === 0 ? (
        showAll ? (
          <EmptyState
            emoji="🪶"
            title="Aucune erreur enregistrée"
            description="Pas une seule entrée dans le journal. Soit Baloo tourne sans accroc, soit logError() n'est pas appelé là où il faudrait."
          />
        ) : (
          <EmptyState
            emoji="✓"
            title="Tout est résolu"
            description="Aucune erreur en attente. Tu peux passer au tab « Toutes » pour voir l'historique."
          />
        )
      ) : (
        <ul className="space-y-3">
          {errors.map((e) => (
            <ErrorItem key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorItem({ entry }: { entry: ErrorLogRow }) {
  const isResolved = !!entry.resolved_at;
  const dataObj = entry.data_json ? safeParse(entry.data_json) : null;
  return (
    <li>
      <Section
        title={entry.message}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <code className="font-mono text-[11.5px] font-medium text-brand">{entry.mod}</code>
            <span className="text-fg-subtle">·</span>
            <span className="tabular-nums text-[12px]">
              {entry.created_at.replace('T', ' ').replace('Z', '')}
            </span>
            {entry.error_name && (
              <>
                <span className="text-fg-subtle">·</span>
                <code className="font-mono text-[11.5px] text-fg-muted">
                  {entry.error_name}
                </code>
              </>
            )}
          </span>
        }
        action={
          isResolved ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <CheckCircle2 size={11} strokeWidth={2.25} />
              Résolu
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              <ShieldAlert size={11} strokeWidth={2.25} />
              Ouvert
            </span>
          )
        }
      >
        {entry.stack && (
          <details className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] font-medium text-fg-muted hover:text-fg transition-colors list-none">
              Voir la stack ({entry.stack.split('\n').length} lignes)
            </summary>
            <pre className="mt-2 text-[11px] font-mono text-fg-muted whitespace-pre-wrap break-words leading-relaxed">
              {entry.stack}
            </pre>
          </details>
        )}

        {dataObj && (
          <details className="rounded-md border border-border-soft bg-bg-sunken/40 px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] font-medium text-fg-muted hover:text-fg transition-colors list-none">
              Voir le contexte
            </summary>
            <pre className="mt-2 text-[11px] font-mono text-fg-muted whitespace-pre-wrap break-words leading-relaxed">
              {JSON.stringify(dataObj, null, 2)}
            </pre>
          </details>
        )}

        {isResolved && entry.resolved_at && (
          <p className="text-[12px] text-fg-muted">
            Résolu le{' '}
            <span className="font-medium text-fg tabular-nums">
              {entry.resolved_at.slice(0, 10)}
            </span>
            {entry.resolved_by_email && (
              <>
                {' '}par <span className="font-medium text-fg">{entry.resolved_by_email}</span>
              </>
            )}
            .
          </p>
        )}

        <div className="flex justify-end">
          {isResolved ? (
            <form action={reopenError.bind(null, entry.id)}>
              <PendingButton variant="ghost" size="sm">
                <RotateCcw size={13} strokeWidth={2} className="mr-1.5" />
                Ré-ouvrir
              </PendingButton>
            </form>
          ) : (
            <form action={resolveError.bind(null, entry.id)}>
              <PendingButton variant="outline" size="sm">
                <CheckCircle2 size={13} strokeWidth={2} className="mr-1.5" />
                Marquer résolue
              </PendingButton>
            </form>
          )}
        </div>
      </Section>
    </li>
  );
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return { value: parsed };
  } catch {
    return { raw: json };
  }
}
