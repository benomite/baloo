import Link from 'next/link';
import { ArrowRight, CheckCircle2, ChevronDown } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import {
  getClotureReport,
  previousMonth,
  buildMonthOptions,
} from '@/lib/queries/cloture';
import { cn } from '@/lib/utils';

// Auth + lecture vivante : pas de prérendu statique.
export const dynamic = 'force-dynamic';

interface SearchParams {
  m?: string; // format YYYY-MM
}

export default async function ClotureMoisPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireAdmin(ctx.role);

  const def = previousMonth();
  const parsed = parseMonthParam(params.m, def);
  const report = await getClotureReport(parsed.year, parsed.month);
  const options = buildMonthOptions();

  const isClotureable = report.totalBlocked === 0;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title={`Clôturer ${report.monthLabel}`}
        subtitle={
          isClotureable
            ? 'Aucun blocage. Tu peux marquer le mois comme bouclé côté Comptaweb.'
            : `${report.totalBlocked} élément${report.totalBlocked > 1 ? 's' : ''} encore à traiter avant clôture.`
        }
        actions={<MonthPicker current={`${parsed.year}-${pad2(parsed.month)}`} options={options} />}
      />

      {isClotureable ? (
        <EmptyState
          emoji="🎉"
          title={`${report.monthLabel} est clôturable`}
          description="Plus rien ne bloque côté Baloo. Va clôturer dans Comptaweb si ce n'est pas déjà fait, et passe au mois suivant."
        />
      ) : (
        <ul className="space-y-2">
          {report.blockers
            .filter((b) => b.count > 0)
            .map((b) => (
              <li
                key={b.kind}
                className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/10"
              >
                <Link
                  href={b.href}
                  className="group flex items-center gap-4 min-w-0"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-900 font-semibold tabular-nums dark:bg-amber-900/40 dark:text-amber-200">
                    {b.count}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-fg leading-tight">
                      {b.count} {b.label}
                    </div>
                    <div className="mt-0.5 text-[12px] text-fg-muted leading-relaxed">
                      {b.hint}
                    </div>
                  </div>
                  <ArrowRight
                    size={16}
                    strokeWidth={2}
                    className="shrink-0 text-fg-subtle transition-colors group-hover:text-brand"
                  />
                </Link>
              </li>
            ))}

          {/* Items à 0 affichés en très discret pour rappeler ce qui a été vérifié */}
          <li className="mt-3 rounded-lg border border-border-soft bg-bg-elevated p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">
              Vérifié, rien à faire
            </div>
            <ul className="space-y-1">
              {report.blockers
                .filter((b) => b.count === 0)
                .map((b) => (
                  <li
                    key={b.kind}
                    className="flex items-center gap-2 text-[12.5px] text-fg-muted"
                  >
                    <CheckCircle2
                      size={12}
                      strokeWidth={2}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                    <span>{b.label}</span>
                  </li>
                ))}
            </ul>
          </li>
        </ul>
      )}
    </div>
  );
}

function MonthPicker({
  current,
  options,
}: {
  current: string;
  options: Array<{ year: number; month: number; label: string }>;
}) {
  return (
    <details className="group/picker relative">
      <summary
        className={cn(
          'cursor-pointer list-none inline-flex items-center gap-1.5 rounded-md',
          'border border-border-soft bg-bg-elevated px-3 py-1.5',
          'text-[12.5px] font-medium text-fg hover:bg-fg/[0.04] transition-colors',
        )}
      >
        Choisir un autre mois
        <ChevronDown
          size={12}
          strokeWidth={2}
          className="transition-transform group-open/picker:rotate-180"
        />
      </summary>
      <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-border-soft bg-bg-elevated p-1 shadow-md">
        <ul>
          {options.map((opt) => {
            const m = `${opt.year}-${pad2(opt.month)}`;
            const isCurrent = m === current;
            return (
              <li key={m}>
                <Link
                  href={`/cloture?m=${m}`}
                  className={cn(
                    'block rounded px-2 py-1 text-[12.5px] transition-colors',
                    isCurrent
                      ? 'bg-brand-50 font-medium text-brand'
                      : 'text-fg-muted hover:bg-fg/[0.04] hover:text-fg',
                  )}
                >
                  {opt.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

function parseMonthParam(
  raw: string | undefined,
  fallback: { year: number; month: number },
): { year: number; month: number } {
  if (!raw) return fallback;
  const m = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return fallback;
  return { year, month };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
