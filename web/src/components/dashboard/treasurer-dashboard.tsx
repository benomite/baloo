import Link from 'next/link';
import {
  HandCoins, Paperclip, FileWarning, Gift, Landmark,
  Wallet, PiggyBank, RefreshCw, CheckCircle2, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { Section } from '@/components/shared/section';
import { Amount } from '@/components/shared/amount';
import { isAllClear, type DashboardData } from '@/lib/services/dashboard';
import { cn } from '@/lib/utils';

interface ActionItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  count: number;
  totalCents?: number;
}

export function TreasurerDashboard({ data }: { data: DashboardData }) {
  const { aTraiter, sante } = data;
  const allClear = isAllClear(aTraiter);

  const depassements = sante.parUnite.filter((u) => u.budget_prevu_depenses > 0 && u.depenses > u.budget_prevu_depenses);

  const actions: ActionItem[] = [
    { key: 'rembs', label: 'Remboursements à traiter', href: '/remboursements', icon: HandCoins, count: aTraiter.rembs.count, totalCents: aTraiter.rembs.totalCents },
    { key: 'depots', label: 'Dépôts membres à rapprocher', href: '/depots', icon: Paperclip, count: aTraiter.depotsARapprocher },
    { key: 'justif', label: 'Dépenses sans justificatif', href: '/inbox', icon: FileWarning, count: aTraiter.depensesSansJustif },
    { key: 'abandons', label: 'Abandons à traiter', href: '/abandons', icon: Gift, count: aTraiter.abandonsATraiter },
    { key: 'banque', label: 'Lignes bancaires non rapprochées', href: '/comptaweb/rapprochement', icon: Landmark, count: aTraiter.draftsBancaires },
  ].filter((a) => a.count > 0);

  return (
    <div className="space-y-8">
      <Section title="À traiter" subtitle={allClear ? undefined : 'Ce qui attend ton action.'}>
        {allClear ? (
          <div className="flex items-center gap-2.5 px-6 py-5 text-fg-muted">
            <CheckCircle2 size={18} strokeWidth={1.75} className="text-emerald-600" />
            <span className="text-[13.5px]">Tout est à jour — rien n&apos;attend ton action.</span>
          </div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {actions.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex items-center gap-3 px-6 py-3 hover:bg-brand-50/40 transition-colors">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                    <a.icon size={15} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-fg">{a.label}</div>
                    {a.totalCents != null && a.totalCents > 0 && (
                      <div className="text-[12px] text-fg-muted">
                        Total : <Amount cents={a.totalCents} />
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100 text-[13px] font-semibold tabular-nums">
                    {a.count}
                  </span>
                  <ArrowRight size={14} strokeWidth={2} className="text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Santé du groupe" subtitle="Photo de l'exercice en cours.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-6 py-5">
          <HealthCard icon={Wallet} label="Trésorerie" href="/ecritures">
            <Amount cents={sante.soldeCents} />
          </HealthCard>
          <HealthCard icon={PiggyBank} label="Engagement remboursements" href="/remboursements">
            <Amount cents={sante.engagementRembsCents} />
          </HealthCard>
          <HealthCard icon={RefreshCw} label="Sync Comptaweb" href="/comptaweb/rapprochement"
            tone={sante.sync.stale ? 'warn' : 'ok'}>
            {sante.sync.isRunning ? 'En cours…' : sante.sync.stale ? 'À resynchroniser' : 'À jour'}
            {sante.nonSyncComptaweb > 0 && ` · ${sante.nonSyncComptaweb} non synchro`}
          </HealthCard>
          <HealthCard icon={Landmark} label="Budgets par unité" href="/budgets">
            {depassements.length > 0
              ? `${depassements.length} dépassement(s)`
              : 'Dans les clous'}
          </HealthCard>
        </div>
      </Section>
    </div>
  );
}

function HealthCard({
  icon: Icon, label, href, tone = 'neutral', children,
}: {
  icon: LucideIcon; label: string; href: string;
  tone?: 'neutral' | 'ok' | 'warn'; children: React.ReactNode;
}) {
  return (
    <Link href={href} className="group flex flex-col gap-1.5 rounded-xl border border-border bg-bg-elevated p-4 hover:border-brand-100 hover:bg-brand-50/40 transition-colors">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={14} strokeWidth={1.75} />
        <span className="text-[12px] font-medium">{label}</span>
      </div>
      <div className={cn(
        'text-[16px] font-semibold tabular-nums text-fg',
        tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'warn' && 'text-amber-700 dark:text-amber-300',
      )}>
        {children}
      </div>
    </Link>
  );
}
