import Link from 'next/link';
import { ArrowRight, Link2, Paperclip } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { requireAdmin } from '@/lib/auth/access';
import { getCurrentContext } from '@/lib/context';
import {
  listInboxItems,
  INBOX_PERIODS,
  type InboxEcriture,
  type InboxJustif,
  type InboxPeriod,
  type InboxSuggestion,
} from '@/lib/queries/inbox';
import { lierEcritureJustif } from '@/lib/actions/inbox';
import { applyAutoLinks } from '@/lib/services/inbox-auto';
import { InboxBoard } from './inbox-board.client';
import { cn } from '@/lib/utils';

// La page tape la BDD à chaque requête (état frais des orphelins).
export const dynamic = 'force-dynamic';

interface SearchParams {
  error?: string;
  linked?: string;
  dismissed?: string;
  rejected?: string;
  period?: string;
  recettes?: string;
}

const PERIOD_LABELS: Record<InboxPeriod, string> = {
  '30j': '30 derniers jours',
  '90j': '90 derniers jours',
  '6mois': '6 derniers mois',
  tout: 'Tout l’historique',
};

function parsePeriod(raw: string | undefined): InboxPeriod {
  if (raw && (INBOX_PERIODS as readonly string[]).includes(raw)) {
    return raw as InboxPeriod;
  }
  return '90j';
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);

  const period = parsePeriod(params.period);
  const includeRecettes = params.recettes === '1';

  // Auto-rapprochement des matchs ultra-parfaits avant de calculer la
  // liste : les paires liées disparaissent automatiquement de l'inbox
  // au rendu suivant.
  const auto = await applyAutoLinks(ctx.groupId);

  const inbox = await listInboxItems({ period, includeRecettes });

  const totalRemaining =
    inbox.suggestions.length +
    inbox.ecrituresOrphelines.length +
    inbox.justifsOrphelins.length;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Inbox"
        subtitle={
          totalRemaining > 0
            ? `${totalRemaining} élément${totalRemaining > 1 ? 's' : ''} à lier — écritures bancaires sans justif d'un côté, justifs déposés sans écriture de l'autre.`
            : 'Tout est lié. Tu peux clôturer le mois.'
        }
      />

      <FilterBar period={period} includeRecettes={includeRecettes} />

      {auto.applied > 0 && (
        <Alert variant="success" className="mb-4">
          ✨ {auto.applied} rapprochement{auto.applied > 1 ? 's' : ''}{' '}
          automatique{auto.applied > 1 ? 's' : ''} (montant exact, date
          quasi-identique). Tu peux les défaire depuis la fiche écriture si
          besoin.
        </Alert>
      )}

      {params.error && (
        <Alert variant="error" className="mb-4">
          {params.error}
        </Alert>
      )}
      {params.linked && (
        <Alert variant="success" className="mb-4">
          Lié{' '}
          <code className="font-mono text-[12.5px] font-medium">
            {params.linked}
          </code>
          .
        </Alert>
      )}
      {params.dismissed && (
        <Alert variant="success" className="mb-4">
          Écriture{' '}
          <code className="font-mono text-[12.5px] font-medium">
            {params.dismissed}
          </code>{' '}
          marquée comme n’attendant pas de justif.
        </Alert>
      )}
      {params.rejected && (
        <Alert variant="success" className="mb-4">
          Justif{' '}
          <code className="font-mono text-[12.5px] font-medium">
            {params.rejected}
          </code>{' '}
          marqué comme non pertinent.
        </Alert>
      )}

      {totalRemaining === 0 ? (
        <EmptyState
          emoji="🐻"
          title="Inbox vide"
          description="Toutes les écritures bancaires ont leur justif et tous les justifs déposés ont leur écriture. Profites-en, prends un café."
        />
      ) : (
        <div className="space-y-8">
          {inbox.suggestions.length > 0 && (
            <SuggestionsSection
              suggestions={inbox.suggestions}
              period={period}
              includeRecettes={includeRecettes}
            />
          )}

          <InboxBoard
            ecritures={inbox.ecrituresOrphelines}
            justifs={inbox.justifsOrphelins}
            truncated={inbox.ecrituresTruncated}
            period={period}
            includeRecettes={includeRecettes}
          />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Barre de filtres
// ────────────────────────────────────────────────────────────────────

function FilterBar({
  period,
  includeRecettes,
}: {
  period: InboxPeriod;
  includeRecettes: boolean;
}) {
  const buildHref = (overrides: Partial<{ period: InboxPeriod; recettes: boolean }>) => {
    const next = {
      period: overrides.period ?? period,
      recettes: overrides.recettes ?? includeRecettes,
    };
    const sp = new URLSearchParams();
    if (next.period !== '90j') sp.set('period', next.period);
    if (next.recettes) sp.set('recettes', '1');
    const qs = sp.toString();
    return qs ? `/inbox?${qs}` : '/inbox';
  };

  return (
    <div className="-mt-2 mb-5 flex flex-wrap items-center gap-3 text-[12.5px]">
      <div className="flex items-center gap-1.5">
        <span className="text-fg-subtle">Période :</span>
        <div className="inline-flex items-center rounded-md border border-border-soft bg-bg-elevated p-0.5">
          {INBOX_PERIODS.map((p) => (
            <Link
              key={p}
              href={buildHref({ period: p })}
              prefetch={false}
              className={cn(
                'rounded px-2 py-0.5 transition-colors',
                p === period
                  ? 'bg-brand text-white font-medium'
                  : 'text-fg-muted hover:text-fg hover:bg-fg/[0.04]',
              )}
              aria-current={p === period ? 'page' : undefined}
            >
              {p === '30j'
                ? '30 j'
                : p === '90j'
                  ? '90 j'
                  : p === '6mois'
                    ? '6 mois'
                    : 'Tout'}
            </Link>
          ))}
        </div>
        <span className="text-fg-subtle text-[11px]">
          ({PERIOD_LABELS[period]})
        </span>
      </div>

      <Link
        href={buildHref({ recettes: !includeRecettes })}
        prefetch={false}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors',
          includeRecettes
            ? 'border-brand bg-brand-50 text-brand'
            : 'border-border-soft bg-bg-elevated text-fg-muted hover:text-fg hover:bg-fg/[0.04]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-3 rounded-sm border',
            includeRecettes
              ? 'border-brand bg-brand'
              : 'border-border bg-bg',
          )}
        />
        Inclure les recettes
      </Link>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Suggestions automatiques (matching parfait)
// ────────────────────────────────────────────────────────────────────

function SuggestionsSection({
  suggestions,
  period,
  includeRecettes,
}: {
  suggestions: InboxSuggestion[];
  period: InboxPeriod;
  includeRecettes: boolean;
}) {
  return (
    <section>
      <SectionTitle
        icon="✨"
        label={`Suggestions automatiques (${suggestions.length})`}
        sub="Montant et date concordent. Un clic pour valider."
      />
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={`${s.ecriture.id}-${s.justif.id}`}
            className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-border-soft bg-bg-elevated p-3"
          >
            <div className="flex-1 min-w-0">
              <EcritureSummary ecriture={s.ecriture} compact />
            </div>
            <ArrowRight
              size={16}
              className="hidden sm:block text-fg-subtle shrink-0"
              strokeWidth={2}
            />
            <div className="flex-1 min-w-0">
              <JustifSummary justif={s.justif} compact />
            </div>
            <form action={lierEcritureJustif} className="shrink-0">
              <input type="hidden" name="ecriture_id" value={s.ecriture.id} />
              <input type="hidden" name="depot_id" value={s.justif.id} />
              <input type="hidden" name="return_period" value={period} />
              <input
                type="hidden"
                name="return_recettes"
                value={includeRecettes ? '1' : '0'}
              />
              <PendingButton size="sm">
                <Link2 size={12} strokeWidth={2} className="mr-1" />
                Lier
              </PendingButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Les colonnes orphelines sont maintenant rendues par
// `<InboxBoard>` (Client Component) — voir inbox-board.client.tsx.

// ────────────────────────────────────────────────────────────────────
// Sous-composants
// ────────────────────────────────────────────────────────────────────

function SectionTitle({
  icon,
  label,
  sub,
}: {
  icon: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-[13px] font-semibold tracking-tight text-fg flex items-center gap-2">
        <span aria-hidden>{icon}</span>
        {label}
      </h2>
      <p className="text-[12px] text-fg-subtle">{sub}</p>
    </div>
  );
}

function EcritureSummary({
  ecriture,
  compact,
}: {
  ecriture: InboxEcriture;
  compact?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="tabular-nums text-[12px] text-fg-subtle shrink-0">
        {ecriture.date_ecriture}
      </span>
      <span
        className={cn(
          'flex-1 min-w-0 truncate text-[13px]',
          compact ? 'font-medium' : 'text-fg',
        )}
      >
        {ecriture.description}
      </span>
      {ecriture.unite_code && (
        <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-medium text-brand">
          {ecriture.unite_code}
        </span>
      )}
      <span className="tabular-nums font-semibold text-[13.5px] shrink-0">
        <Amount
          cents={ecriture.amount_cents}
          tone={ecriture.type === 'depense' ? 'negative' : 'positive'}
        />
      </span>
    </div>
  );
}

function JustifSummary({
  justif,
  compact,
}: {
  justif: InboxJustif;
  compact?: boolean;
}) {
  const submitter = justif.submitter_name ?? justif.submitter_email;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-[13px]',
            compact ? 'font-medium' : 'text-fg',
          )}
        >
          {justif.titre}
        </span>
        {justif.amount_cents != null && (
          <span className="tabular-nums font-semibold text-[13.5px] shrink-0">
            <Amount cents={justif.amount_cents} />
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
        <span>{submitter}</span>
        {justif.date_estimee && (
          <span className="tabular-nums">· {justif.date_estimee}</span>
        )}
        {justif.unite_code && (
          <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand">
            {justif.unite_code}
          </span>
        )}
        {justif.justif_path && (
          <Link
            href={`/api/justificatifs/${justif.justif_path}`}
            target="_blank"
            rel="noopener"
            className="ml-auto inline-flex items-center gap-1 text-brand hover:underline underline-offset-2"
          >
            <Paperclip size={11} strokeWidth={1.75} />
            voir
          </Link>
        )}
      </div>
    </div>
  );
}

