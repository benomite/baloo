import Link from 'next/link';
import {
  ArrowRight,
  CircleHelp,
  Gift,
  HandCoins,
  Inbox,
  Paperclip,
  Sparkles,
  TrendingUp,
  Unlink,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Section, SectionHeader } from '@/components/shared/section';
import { Amount } from '@/components/shared/amount';
import {
  AbandonStatusBadge,
  RemboursementStatusBadge,
} from '@/components/shared/status-badge';
import { Alert } from '@/components/ui/alert';
import { PendingButton } from '@/components/shared/pending-button';
import { getCurrentContext } from '@/lib/context';
import { getDb } from '@/lib/db';
import { listRemboursements } from '@/lib/services/remboursements';
import { listAbandons } from '@/lib/services/abandons';
import {
  describeAbandonStatus,
  describeRembsStatus,
} from '@/lib/status-descriptions';
import {
  dismissWelcomeBanner,
  isWelcomeBannerDismissed,
} from '@/lib/actions/onboarding';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  tresorier: 'trésorier',
  RG: 'responsable de groupe',
  chef: "chef d'unité",
  equipier: 'équipier',
  parent: 'parent',
};

interface SearchParams {
  error?: string;
  rbt_created?: string;
  abandon_created?: string;
}

const ADMIN_ROLES = ['tresorier', 'RG'];
const SUBMIT_ROLES = ['tresorier', 'RG', 'chef', 'equipier'];

interface AdminCounts {
  rembsAValider: number;
  abandonsAValider: number;
  depotsATraiter: number;
  rembsARattacher: number;
}

async function getAdminCounts(groupId: string): Promise<AdminCounts> {
  const db = getDb();
  const [rembs, abandons, depots, unlinked] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM remboursements
         WHERE group_id = ? AND status IN ('a_traiter', 'valide_tresorier')`,
      )
      .get<{ n: number }>(groupId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM abandons_frais
         WHERE group_id = ? AND status IN ('a_traiter', 'valide')`,
      )
      .get<{ n: number }>(groupId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM depots_justificatifs
         WHERE group_id = ? AND statut = 'a_traiter'`,
      )
      .get<{ n: number }>(groupId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM remboursements
         WHERE group_id = ? AND ecriture_id IS NULL
           AND status IN ('virement_effectue', 'termine')`,
      )
      .get<{ n: number }>(groupId),
  ]);
  return {
    rembsAValider: rembs?.n ?? 0,
    abandonsAValider: abandons?.n ?? 0,
    depotsATraiter: depots?.n ?? 0,
    rembsARattacher: unlinked?.n ?? 0,
  };
}

function firstName(fullName: string | null | undefined, email: string): string {
  if (fullName) {
    const trimmed = fullName.trim();
    if (trimmed) return trimmed.split(/\s+/)[0];
  }
  return email.split('@')[0];
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [ctx, sp, welcomeDismissed] = await Promise.all([
    getCurrentContext(),
    searchParams,
    isWelcomeBannerDismissed(),
  ]);

  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const canSubmit = SUBMIT_ROLES.includes(ctx.role);

  const [myRbts, myAbandons, adminCounts] = await Promise.all([
    canSubmit
      ? listRemboursements(
          { groupId: ctx.groupId, submittedByUserId: ctx.userId },
          { limit: 5 },
        )
      : Promise.resolve([]),
    canSubmit
      ? listAbandons(
          { groupId: ctx.groupId, submittedByUserId: ctx.userId },
          { limit: 5 },
        )
      : Promise.resolve([]),
    isAdmin ? getAdminCounts(ctx.groupId) : Promise.resolve(null),
  ]);

  const hello = `Bonjour ${firstName(ctx.name, ctx.email)}`;
  const hasMyDemands = myRbts.length > 0 || myAbandons.length > 0;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={hello}
        subtitle="Tes demandes et tes raccourcis pour faire avancer la compta du groupe."
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}
      {sp.rbt_created && (
        <Alert variant="success" className="mb-4">
          Demande <code className="font-mono text-[12.5px] font-medium">{sp.rbt_created}</code>{' '}
          envoyée. Tu recevras un email à chaque étape.
        </Alert>
      )}
      {sp.abandon_created && (
        <Alert variant="success" className="mb-4">
          Abandon <code className="font-mono text-[12.5px] font-medium">{sp.abandon_created}</code>{' '}
          déclaré. Le trésorier émettra le reçu fiscal.
        </Alert>
      )}

      {!welcomeDismissed && (
        <WelcomeBanner roleLabel={ROLE_LABEL[ctx.role] ?? ctx.role} canSubmit={canSubmit} />
      )}

      <div className="space-y-8">
        {canSubmit && <QuickActions />}

        {canSubmit && (
          <MyDemandsSection rbts={myRbts} abandons={myAbandons} hasAny={hasMyDemands} />
        )}

        {isAdmin && adminCounts && <AdminTodoSection counts={adminCounts} />}

        {isAdmin && <SyntheseLink />}
      </div>
    </div>
  );
}

function WelcomeBanner({
  roleLabel,
  canSubmit,
}: {
  roleLabel: string;
  canSubmit: boolean;
}) {
  return (
    <div className="mb-6 relative rounded-xl border border-brand-100 bg-brand-50/40 px-4 py-3 sm:px-5 sm:py-4">
      <form
        action={dismissWelcomeBanner}
        className="absolute top-2 right-2"
      >
        <PendingButton
          variant="ghost"
          size="icon-sm"
          pendingLabel=""
          className="text-fg-subtle hover:text-fg"
          aria-label="Masquer le message de bienvenue"
        >
          <X size={13} strokeWidth={2} />
        </PendingButton>
      </form>
      <div className="flex items-start gap-3 pr-8">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-bg-elevated">
          <Sparkles size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-fg leading-tight">
            Bienvenue sur Baloo
          </h2>
          <p className="mt-1 text-[12.5px] text-fg-muted leading-relaxed">
            Tu es {roleLabel} dans ton groupe SGDF.{' '}
            {canSubmit
              ? 'Tu peux déposer un justif, demander un remboursement ou déclarer un abandon — utilise les raccourcis ci-dessous.'
              : 'Tu peux suivre tes paiements et tes reçus fiscaux directement depuis cette page.'}{' '}
            Pour comprendre comment tout marche,{' '}
            <Link
              href="/aide"
              className="font-medium text-brand hover:underline underline-offset-2"
            >
              consulte la page d&apos;aide
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

function QuickActions() {
  const actions: { href: string; label: string; description: string; icon: LucideIcon }[] = [
    {
      href: '/depot',
      label: 'Déposer un justif',
      description: "Une photo, un PDF — le trésorier rapproche après.",
      icon: Paperclip,
    },
    {
      href: '/moi/remboursements/nouveau',
      label: 'Demander un remboursement',
      description: "Tu as avancé des frais ? Saisis ta demande et joins le justif.",
      icon: HandCoins,
    },
    {
      href: '/moi/abandons/nouveau',
      label: 'Déclarer un abandon',
      description: 'Renoncer au remboursement → reçu fiscal CERFA pour défiscaliser.',
      icon: Gift,
    },
  ];

  return (
    <div>
      <SectionHeader title="Que veux-tu faire ?" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {actions.map((a) => (
          <ActionCard key={a.href} {...a} />
        ))}
      </div>
      <Link
        href="/aide#rembs-vs-abandon"
        className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted hover:text-brand hover:underline underline-offset-2 transition-colors"
      >
        <CircleHelp size={13} strokeWidth={1.75} />
        Hésite entre remboursement et abandon ? Compare en 30 secondes.
      </Link>
    </div>
  );
}

function ActionCard({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1.5 rounded-xl border border-border bg-bg-elevated p-4 transition-colors hover:border-brand-100 hover:bg-brand-50/40"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand transition-colors group-hover:bg-brand group-hover:text-bg-elevated">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <ArrowRight
          size={14}
          strokeWidth={2}
          className="text-fg-subtle transition-colors group-hover:text-brand"
        />
      </div>
      <div className="text-[13.5px] font-medium text-fg leading-tight">{label}</div>
      <div className="text-[12px] text-fg-muted leading-relaxed">{description}</div>
    </Link>
  );
}

interface MergedDemand {
  kind: 'rembs' | 'abandon';
  id: string;
  href: string;
  title: string;
  amountCents: number;
  date: string;
  createdAt: string;
  status: string;
  cerfaEmis?: boolean;
}

function MyDemandsSection({
  rbts,
  abandons,
  hasAny,
}: {
  rbts: Awaited<ReturnType<typeof listRemboursements>>;
  abandons: Awaited<ReturnType<typeof listAbandons>>;
  hasAny: boolean;
}) {
  const merged: MergedDemand[] = [
    ...rbts.map((r) => ({
      kind: 'rembs' as const,
      id: r.id,
      href: `/remboursements/${r.id}`,
      title: r.nature ?? '(sans nature)',
      amountCents: r.total_cents || r.amount_cents,
      date: r.date_depense ?? r.created_at.slice(0, 10),
      createdAt: r.created_at,
      status: r.status,
    })),
    ...abandons.map((a) => ({
      kind: 'abandon' as const,
      id: a.id,
      href: `/abandons/${a.id}`,
      title: a.nature,
      amountCents: a.amount_cents,
      date: a.date_depense,
      createdAt: a.created_at,
      status: a.status,
      cerfaEmis: a.cerfa_emis === 1,
    })),
  ]
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    .slice(0, 5);

  return (
    <Section
      title="Mes demandes"
      subtitle={hasAny ? 'Les 5 dernières — clique pour voir le détail.' : undefined}
      action={
        hasAny ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
            <Link
              href="/remboursements"
              className="inline-flex items-center gap-1 font-medium text-brand hover:underline underline-offset-2"
            >
              Tous mes rembs
              <ArrowRight size={12} strokeWidth={2} />
            </Link>
            <Link
              href="/abandons"
              className="inline-flex items-center gap-1 font-medium text-brand hover:underline underline-offset-2"
            >
              Tous mes abandons
              <ArrowRight size={12} strokeWidth={2} />
            </Link>
          </div>
        ) : undefined
      }
      bodyClassName="px-0 pb-0"
    >
      {!hasAny ? (
        <div className="px-6 pb-6">
          <p className="text-[13px] text-fg-muted">
            Tu n&apos;as pas encore fait de demande. Utilise les raccourcis ci-dessus pour en
            saisir une.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border-soft">
          {merged.map((d) => {
            const desc =
              d.kind === 'rembs'
                ? describeRembsStatus(d.status)
                : describeAbandonStatus(d.status, d.cerfaEmis ?? false);
            return (
              <li key={`${d.kind}-${d.id}`}>
                <Link
                  href={d.href}
                  className="flex items-start gap-3 px-6 py-3 hover:bg-brand-50/40 transition-colors"
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg mt-0.5',
                      d.kind === 'rembs'
                        ? 'bg-brand-50 text-brand'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200',
                    )}
                  >
                    {d.kind === 'rembs' ? (
                      <HandCoins size={14} strokeWidth={1.75} />
                    ) : (
                      <Gift size={14} strokeWidth={1.75} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-fg truncate">{d.title}</div>
                    <div className="text-[12px] text-fg-muted">
                      <code className="font-mono text-[11.5px]">{d.id}</code>
                      <span className="mx-1.5 text-fg-subtle">·</span>
                      <span className="tabular-nums">{d.date}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-fg-muted leading-snug">
                      {desc.text}
                      {desc.actionRequired && (
                        <span className="ml-1.5 font-medium text-destructive">
                          {desc.actionRequired}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium tabular-nums text-fg">
                      <Amount cents={d.amountCents} />
                    </div>
                    <div className="mt-0.5">
                      {d.kind === 'rembs' ? (
                        <RemboursementStatusBadge status={d.status} />
                      ) : (
                        <AbandonStatusBadge status={d.status} />
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function AdminTodoSection({ counts }: { counts: AdminCounts }) {
  const items: {
    href: string;
    label: string;
    count: number;
    icon: LucideIcon;
    accent: 'brand' | 'amber' | 'red';
  }[] = [
    {
      href: '/remboursements?status=a_traiter',
      label: 'Remb. à valider',
      count: counts.rembsAValider,
      icon: HandCoins,
      accent: 'amber',
    },
    {
      href: '/abandons?status=a_traiter',
      label: 'Abandons à valider',
      count: counts.abandonsAValider,
      icon: Gift,
      accent: 'amber',
    },
    {
      href: '/depots',
      label: 'Dépôts à rapprocher',
      count: counts.depotsATraiter,
      icon: Inbox,
      accent: 'brand',
    },
    {
      href: '/remboursements?unlinked=1',
      label: 'Remb. à rattacher',
      count: counts.rembsARattacher,
      icon: Unlink,
      accent: 'red',
    },
  ];

  return (
    <div>
      <SectionHeader
        title="À traiter pour le groupe"
        subtitle="Ta to-do de trésorier — chaque chiffre est cliquable."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((it) => (
          <TodoCard key={it.href} {...it} />
        ))}
      </div>
    </div>
  );
}

function TodoCard({
  href,
  label,
  count,
  icon: Icon,
  accent,
}: {
  href: string;
  label: string;
  count: number;
  icon: LucideIcon;
  accent: 'brand' | 'amber' | 'red';
}) {
  const accentClasses = {
    brand: 'bg-brand-50 text-brand',
    amber:
      'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
    red: 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200',
  };
  const isZero = count === 0;
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-4 transition-colors',
        isZero
          ? 'opacity-60 hover:opacity-100'
          : 'hover:border-brand-100 hover:bg-brand-50/40',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            isZero ? 'bg-bg-sunken text-fg-subtle' : accentClasses[accent],
          )}
        >
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <ArrowRight
          size={14}
          strokeWidth={2}
          className="text-fg-subtle transition-colors group-hover:text-brand"
        />
      </div>
      <div>
        <div className="text-display-sm tabular-nums leading-none text-fg">{count}</div>
        <div className="mt-1 text-[12.5px] text-fg-muted">{label}</div>
      </div>
    </Link>
  );
}

function SyntheseLink() {
  return (
    <Link
      href="/synthese"
      className="group flex items-center justify-between rounded-xl border border-border bg-bg-elevated px-4 py-3.5 hover:border-brand-100 hover:bg-brand-50/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand transition-colors group-hover:bg-brand group-hover:text-bg-elevated">
          <TrendingUp size={16} strokeWidth={1.75} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium text-fg leading-tight">
            Synthèse trésorerie
          </div>
          <div className="text-[12px] text-fg-muted leading-relaxed">
            KPIs, répartition par unité, dernier import Comptaweb.
          </div>
        </div>
      </div>
      <ArrowRight
        size={14}
        strokeWidth={2}
        className="text-fg-subtle transition-colors group-hover:text-brand"
      />
    </Link>
  );
}

