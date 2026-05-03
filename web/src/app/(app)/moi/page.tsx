import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Gift,
  HandCoins,
  Plus,
  Receipt,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section } from '@/components/shared/section';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Amount } from '@/components/shared/amount';
import {
  AbandonStatusBadge,
  RemboursementStatusBadge,
} from '@/components/shared/status-badge';
import { getCurrentContext } from '@/lib/context';
import { listRemboursements } from '@/lib/services/remboursements';
import { listAbandons } from '@/lib/services/abandons';

interface SearchParams {
  error?: string;
  rbt_created?: string;
  abandon_created?: string;
}

export default async function MoiPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  const canRequest = ctx.role !== 'parent';

  const [myRbts, myAbandons] = await Promise.all([
    canRequest
      ? listRemboursements(
          { groupId: ctx.groupId, submittedByUserId: ctx.userId },
          { limit: 50 },
        )
      : Promise.resolve([]),
    canRequest
      ? listAbandons(
          { groupId: ctx.groupId, submittedByUserId: ctx.userId },
          { limit: 50 },
        )
      : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Mon espace"
        subtitle={`Bienvenue ${ctx.name ?? ctx.email} — tes demandes, tes dons, tes paiements.`}
      />

      {params.error && (
        <Alert variant="error" className="mb-4">
          {params.error}
        </Alert>
      )}
      {params.rbt_created && (
        <Alert variant="success" className="mb-4">
          Demande{' '}
          <code className="font-mono text-[12.5px] font-medium">{params.rbt_created}</code>{' '}
          envoyée. Tu recevras un email à chaque étape.
        </Alert>
      )}
      {params.abandon_created && (
        <Alert variant="success" className="mb-4">
          Abandon{' '}
          <code className="font-mono text-[12.5px] font-medium">{params.abandon_created}</code>{' '}
          déclaré. Le trésorier émettra le reçu fiscal.
        </Alert>
      )}

      <div className="space-y-6">
        {canRequest ? (
          <RemboursementsSection rbts={myRbts} />
        ) : (
          <PlaceholderSection
            title="Mes remboursements"
            statusLabel="lecture seule"
            description="En tant que parent, tu peux suivre tes propres demandes de remboursement de cotisations / inscriptions ici. Pour l'instant, contacte le trésorier directement."
          />
        )}

        {canRequest ? (
          <AbandonsSection abandons={myAbandons} />
        ) : (
          <PlaceholderSection
            title="Mes dons et abandons de frais"
            statusLabel="à venir"
            description="Tes reçus fiscaux (CERFA) et l'historique de tes dons au groupe."
          />
        )}

        <PlaceholderSection
          title="Mes paiements"
          statusLabel="à venir"
          description="Les inscriptions, camps et activités de tes enfants, et leur état de règlement."
        />
      </div>
    </div>
  );
}

function RemboursementsSection({
  rbts,
}: {
  rbts: Awaited<ReturnType<typeof listRemboursements>>;
}) {
  const total = rbts.reduce((sum, r) => sum + (r.total_cents || r.amount_cents), 0);
  return (
    <Section
      title={`Mes remboursements (${rbts.length})`}
      subtitle={
        rbts.length > 0
          ? `Total cumulé : ${formatTotal(total)}`
          : "Aucune demande pour l'instant."
      }
      action={
        <Link href="/moi/remboursements/nouveau">
          <Button size="sm">
            <Plus size={14} strokeWidth={2.25} className="mr-1" />
            Nouvelle demande
          </Button>
        </Link>
      }
      bodyClassName={rbts.length === 0 ? undefined : 'px-0 pb-0'}
    >
      {rbts.length === 0 ? (
        <p className="text-[13px] text-fg-muted leading-relaxed">
          Tu n&apos;as encore fait aucune demande. Si tu as avancé des frais pour le groupe,
          clique sur « Nouvelle demande ».
        </p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {rbts.map((r) => (
            <li key={r.id}>
              <Link
                href={`/remboursements/${r.id}`}
                className="flex items-center gap-3 px-6 py-3 hover:bg-brand-50/40 transition-colors"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
                  <HandCoins size={14} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-fg truncate">
                    {r.nature ?? '(sans nature)'}
                  </div>
                  <div className="text-[12px] text-fg-muted">
                    <code className="font-mono text-[11.5px]">{r.id}</code>
                    <span className="mx-1.5 text-fg-subtle">·</span>
                    <span className="tabular-nums">
                      {r.date_depense ?? r.created_at.slice(0, 10)}
                    </span>
                    {r.date_paiement && (
                      <>
                        <span className="mx-1.5 text-fg-subtle">·</span>
                        <span className="tabular-nums">payé le {r.date_paiement}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-medium tabular-nums text-fg">
                    <Amount cents={r.total_cents || r.amount_cents} />
                  </div>
                  <div className="mt-0.5">
                    <RemboursementStatusBadge status={r.status} />
                  </div>
                </div>
                <ArrowRight
                  size={14}
                  strokeWidth={2}
                  className="ml-1 shrink-0 text-fg-subtle"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AbandonsSection({
  abandons,
}: {
  abandons: Awaited<ReturnType<typeof listAbandons>>;
}) {
  const total = abandons.reduce((sum, a) => sum + a.amount_cents, 0);
  const cerfaCount = abandons.filter((a) => a.cerfa_emis === 1).length;
  return (
    <Section
      title={`Mes dons (${abandons.length})`}
      subtitle={
        abandons.length > 0
          ? `Total cumulé : ${formatTotal(total)} · ${cerfaCount} CERFA émis`
          : 'Tes abandons de frais ouvrant droit à reçu fiscal.'
      }
      action={
        <Link href="/moi/abandons/nouveau">
          <Button size="sm" variant="outline">
            <Plus size={14} strokeWidth={2.25} className="mr-1" />
            Nouveau don
          </Button>
        </Link>
      }
      bodyClassName={abandons.length === 0 ? undefined : 'px-0 pb-0'}
    >
      {abandons.length === 0 ? (
        <p className="text-[13px] text-fg-muted leading-relaxed">
          Tu n&apos;as fait aucun don déclaré. Si tu souhaites renoncer au remboursement de frais
          que tu as avancés (et recevoir un reçu fiscal CERFA), clique sur «&nbsp;Nouveau don&nbsp;».
        </p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {abandons.map((a) => (
            <li key={a.id}>
              <Link
                href={`/abandons/${a.id}`}
                className="flex items-center gap-3 px-6 py-3 hover:bg-brand-50/40 transition-colors"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                  <Gift size={14} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-fg truncate">
                    {a.nature}
                  </div>
                  <div className="text-[12px] text-fg-muted">
                    <code className="font-mono text-[11.5px]">{a.id}</code>
                    <span className="mx-1.5 text-fg-subtle">·</span>
                    <span className="tabular-nums">{a.date_depense}</span>
                    <span className="mx-1.5 text-fg-subtle">·</span>
                    <span>année fiscale {a.annee_fiscale}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-medium tabular-nums text-fg">
                    <Amount cents={a.amount_cents} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-1.5">
                    <AbandonStatusBadge status={a.status} />
                    {a.cerfa_emis === 1 ? (
                      <span
                        title="CERFA émis"
                        className="inline-flex items-center text-emerald-600 dark:text-emerald-400"
                      >
                        <CheckCircle2 size={13} strokeWidth={2.25} />
                      </span>
                    ) : (
                      <span
                        title="CERFA non émis"
                        className="inline-flex items-center text-fg-subtle"
                      >
                        <Circle size={13} strokeWidth={2} />
                      </span>
                    )}
                  </div>
                </div>
                <ArrowRight
                  size={14}
                  strokeWidth={2}
                  className="ml-1 shrink-0 text-fg-subtle"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PlaceholderSection({
  title,
  statusLabel,
  description,
}: {
  title: string;
  statusLabel: string;
  description: string;
}) {
  return (
    <Section
      title={title}
      action={
        <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-bg-sunken px-2 py-0.5 text-[11px] font-medium text-fg-muted italic">
          <Receipt size={11} strokeWidth={2} />
          {statusLabel}
        </span>
      }
    >
      <p className="text-[13px] text-fg-muted leading-relaxed">{description}</p>
    </Section>
  );
}

function formatTotal(cents: number): string {
  return (cents / 100)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
}
