import Link from 'next/link';
import { CheckCircle2, Circle, Plus } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { AbandonStatusBadge } from '@/components/shared/status-badge';
import { Amount } from '@/components/shared/amount';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/shared/empty-state';
import { TabLink } from '@/components/shared/tab-link';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { requireAdmin } from '@/lib/auth/access';
import { listAbandons, type AbandonStatus } from '@/lib/services/abandons';
import { toggleCerfaEmis } from '@/lib/actions/abandons';

interface SearchParams {
  status?: string;
  error?: string;
}

const FILTERS: { key: AbandonStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'a_traiter', label: 'À traiter' },
  { key: 'valide', label: 'Validés' },
  { key: 'envoye_national', label: 'Envoyés' },
  { key: 'refuse', label: 'Refusés' },
];

function isAbandonStatus(value: string | undefined): value is AbandonStatus {
  return (
    value === 'a_traiter' ||
    value === 'valide' ||
    value === 'envoye_national' ||
    value === 'refuse'
  );
}

export default async function AbandonsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const params = await searchParams;
  const activeFilter: AbandonStatus | 'all' = isAbandonStatus(params.status)
    ? params.status
    : 'all';

  // On charge tout pour pouvoir afficher les counters par status sur
  // les tabs sans seconde requête.
  const all = await listAbandons({ groupId: ctx.groupId }, { limit: 500 });
  const counters = {
    all: all.length,
    a_traiter: all.filter((a) => a.status === 'a_traiter').length,
    valide: all.filter((a) => a.status === 'valide').length,
    envoye_national: all.filter((a) => a.status === 'envoye_national').length,
    refuse: all.filter((a) => a.status === 'refuse').length,
  };
  const visible = activeFilter === 'all' ? all : all.filter((a) => a.status === activeFilter);

  const byYear = new Map<string, typeof visible>();
  for (const a of visible) {
    const list = byYear.get(a.annee_fiscale) ?? [];
    list.push(a);
    byYear.set(a.annee_fiscale, list);
  }
  const years = [...byYear.keys()].sort().reverse();

  return (
    <div>
      <PageHeader
        title="Abandons de frais"
        subtitle="Dons aux dépenses du groupe ouvrant droit à reçu fiscal CERFA."
        actions={
          <Link href="/abandons/nouveau">
            <Button size="sm">
              <Plus size={14} strokeWidth={2.25} className="mr-1" />
              Nouvelle demande
            </Button>
          </Link>
        }
      />

      {params.error && (
        <Alert variant="error" className="mb-4">
          {params.error}
        </Alert>
      )}

      <div className="mb-6 flex flex-wrap gap-6 border-b">
        {FILTERS.map((f) => {
          const count = counters[f.key];
          const active = activeFilter === f.key;
          const href = f.key === 'all' ? '/abandons' : `/abandons?status=${f.key}`;
          return (
            <TabLink key={f.key} href={href} active={active}>
              <span className="inline-flex items-center gap-1.5">
                {f.label}
                {count > 0 && (
                  <span
                    className={
                      'inline-flex items-center justify-center rounded-full text-[10.5px] font-semibold px-1.5 min-w-[18px] h-[18px] ' +
                      (active
                        ? 'bg-brand-100 text-brand'
                        : 'bg-bg-sunken text-fg-muted')
                    }
                  >
                    {count}
                  </span>
                )}
              </span>
            </TabLink>
          );
        })}
      </div>

      {visible.length === 0 ? (
        activeFilter === 'all' ? (
          <EmptyState
            emoji="🎁"
            title="Aucun abandon de frais"
            description="Quand un bénévole renonce à se faire rembourser des frais avancés pour le groupe, ça se déclare ici. Reçu fiscal CERFA généré pour qu'il puisse défiscaliser."
          />
        ) : (
          <EmptyState
            emoji="✓"
            title="Rien dans cette catégorie"
            description="Aucun abandon dans le statut sélectionné."
          />
        )
      ) : (
        years.map((year) => {
          const items = byYear.get(year)!;
          const total = items.reduce((s, a) => s + a.amount_cents, 0);
          return (
            <section key={year} className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-fg">
                  Année fiscale {year}
                </h2>
                <span className="text-[12.5px] text-fg-muted">
                  total{' '}
                  <span className="font-medium text-fg">
                    <Amount cents={total} />
                  </span>{' '}
                  · {items.length} demande{items.length > 1 ? 's' : ''}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Réf.</TableHead>
                    <TableHead>Donateur</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Nature</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Unité</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>CERFA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link
                          href={`/abandons/${a.id}`}
                          className="font-mono text-[12.5px] text-brand hover:underline"
                        >
                          {a.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/abandons/${a.id}`}
                          className="hover:underline font-medium"
                        >
                          {a.donateur}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {a.date_depense}
                      </TableCell>
                      <TableCell>{a.nature}</TableCell>
                      <TableCell className="text-right font-medium">
                        <Amount cents={a.amount_cents} />
                      </TableCell>
                      <TableCell>{a.unite_code ?? '—'}</TableCell>
                      <TableCell>
                        <AbandonStatusBadge status={a.status} />
                      </TableCell>
                      <TableCell>
                        <form action={toggleCerfaEmis} className="inline">
                          <input type="hidden" name="id" value={a.id} />
                          <input
                            type="hidden"
                            name="cerfa_emis"
                            value={a.cerfa_emis ? '0' : '1'}
                          />
                          {a.cerfa_emis ? (
                            <PendingButton
                              variant="ghost"
                              size="sm"
                              className="text-emerald-700 dark:text-emerald-400"
                            >
                              <CheckCircle2
                                size={13}
                                strokeWidth={2.25}
                                className="mr-1"
                              />
                              Émis
                            </PendingButton>
                          ) : (
                            <PendingButton variant="ghost" size="sm" className="text-fg-muted">
                              <Circle size={13} strokeWidth={2} className="mr-1" />
                              Marquer
                            </PendingButton>
                          )}
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          );
        })
      )}
    </div>
  );
}
