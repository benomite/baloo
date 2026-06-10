import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Section } from '@/components/shared/section';
import { Amount } from '@/components/shared/amount';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { UniteBadge } from '@/components/shared/unite-badge';
import { getCurrentContext } from '@/lib/context';
import {
  getCampDashboard,
  type CampStatut,
} from '@/lib/services/camps';
import type { CampPoste } from '@/lib/services/camp-budget';
import { setCampStatut } from '@/lib/actions/camps';

const ADMIN_ROLES = ['tresorier', 'RG'];

const STATUT_CHIP: Record<CampStatut, { label: string; className: string }> = {
  preparation: {
    label: 'Préparation',
    className:
      'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  },
  en_cours: {
    label: 'En cours',
    className:
      'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  },
  cloture: {
    label: 'Clôturé',
    className: 'bg-bg-sunken text-fg-muted',
  },
};

// Barre de progression budget : verte tant qu'on est sous le budget,
// rouge si on dépasse. Si pas de budget mais une dépense → 100 % (alerte
// visuelle qu'on dépense sans cadre).
function Jauge({ done, total }: { done: number; total: number }) {
  const pct =
    total > 0 ? Math.min(100, Math.round((done / total) * 100)) : done > 0 ? 100 : 0;
  const over = total > 0 && done > total;
  return (
    <div className="h-2 rounded-full bg-bg-sunken overflow-hidden">
      <div
        className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatutChip({ statut }: { statut: CampStatut }) {
  const s = STATUT_CHIP[statut] ?? STATUT_CHIP.preparation;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}

// Bouton de transition de statut (un form par transition possible).
function StatutForm({
  id,
  statut,
  label,
}: {
  id: string;
  statut: CampStatut;
  label: string;
}) {
  return (
    <form action={setCampStatut}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="statut" value={statut} />
      <PendingButton variant="outline" size="sm">
        {label}
      </PendingButton>
    </form>
  );
}

export default async function CampDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [ctx, { id }, sp] = await Promise.all([
    getCurrentContext(),
    params,
    searchParams,
  ]);
  const dashboard = await getCampDashboard(
    { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
    id,
  );
  if (!dashboard) notFound();

  const { camp, rows, ecrituresRecentes, depotsEnAttente, justifsManquants } =
    dashboard;
  const isAdmin = ADMIN_ROLES.includes(ctx.role);
  const dates =
    camp.date_debut || camp.date_fin
      ? `${camp.date_debut ?? '?'} → ${camp.date_fin ?? '?'}`
      : undefined;
  const totalDepots = rows.postes.reduce((s, p) => s + p.depotsCents, 0);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Camps', href: '/camps' }}
        title={camp.name}
        subtitle={dates}
        meta={
          <>
            <StatutChip statut={camp.statut} />
            <UniteBadge
              code={camp.unite_code}
              name={camp.unite_name}
              couleur={camp.unite_couleur}
            />
          </>
        }
        actions={
          <>
            <Link
              href={`/depot?activite=${camp.activite_id}&unite=${camp.unite_id}`}
            >
              <Button variant="outline" size="sm">
                <Upload size={14} strokeWidth={2.25} />
                Déposer un justif
              </Button>
            </Link>
            {isAdmin && camp.statut === 'preparation' && (
              <StatutForm id={camp.id} statut="en_cours" label="Démarrer le camp" />
            )}
            {isAdmin && camp.statut === 'en_cours' && (
              <StatutForm id={camp.id} statut="cloture" label="Clôturer le camp" />
            )}
            {isAdmin && camp.statut === 'cloture' && (
              <StatutForm id={camp.id} statut="en_cours" label="Rouvrir" />
            )}
          </>
        }
      />

      {sp.error && (
        <Alert variant="error" className="mb-4">
          {sp.error}
        </Alert>
      )}

      <div className="space-y-6">
        <Section title="Budget dépenses">
          {rows.postes.length === 0 ? (
            <p className="text-[13px] text-fg-muted">
              Aucune dépense ni budget sur ce camp pour l’instant.
            </p>
          ) : (
            <div className="space-y-3.5">
              {rows.postes.map((p) => (
                <PosteRow key={p.categoryId ?? '__none__'} poste={p} />
              ))}
              <div className="pt-3 border-t border-border-soft">
                <div className="flex items-baseline justify-between gap-3 font-semibold text-[13.5px]">
                  <span className="text-fg">Total</span>
                  <span className="tabular-nums text-fg">
                    <Amount cents={rows.totalDepenseCents} />
                    <span className="text-fg-subtle font-normal"> / </span>
                    <Amount cents={rows.totalBudgetDepensesCents} tone="muted" />
                  </span>
                </div>
                <div className="mt-2">
                  <Jauge
                    done={rows.totalDepenseCents}
                    total={rows.totalBudgetDepensesCents}
                  />
                </div>
                {totalDepots > 0 && (
                  <p className="mt-2 text-[11.5px] text-fg-subtle">
                    dont <Amount cents={totalDepots} /> en tickets déposés, en
                    attente de rapprochement.
                  </p>
                )}
              </div>
            </div>
          )}
        </Section>

        <Section title="Recettes">
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="text-fg-muted">Encaissé / attendu</span>
            <span className="tabular-nums">
              <Amount cents={rows.recettesEncaisseesCents} tone="positive" />
              <span className="text-fg-subtle"> / </span>
              <Amount cents={rows.totalBudgetRecettesCents} tone="muted" />
            </span>
          </div>
          <div className="mt-2">
            <Jauge
              done={rows.recettesEncaisseesCents}
              total={rows.totalBudgetRecettesCents}
            />
          </div>
        </Section>

        {justifsManquants.length > 0 && (
          <Section title="Justificatifs manquants">
            <Alert variant="warning" className="mb-3">
              {justifsManquants.length} dépense
              {justifsManquants.length > 1 ? 's' : ''} sans justificatif rattaché.
            </Alert>
            <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
              {justifsManquants.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/ecritures/${e.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 text-[13px] transition-colors hover:bg-bg-sunken/40"
                  >
                    <span className="tabular-nums text-fg-subtle shrink-0">
                      {e.date_ecriture}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {e.description}
                    </span>
                    <span className="tabular-nums shrink-0">
                      <Amount cents={e.amount_cents} tone="negative" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Dépenses récentes">
          {depotsEnAttente.length === 0 && ecrituresRecentes.length === 0 ? (
            <EmptyState
              title="Rien à afficher"
              description="Aucune dépense ni ticket en attente sur ce camp."
              className="py-6"
            />
          ) : (
            <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
              {depotsEnAttente.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-3 px-3 py-2.5 text-[13px]"
                >
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 shrink-0">
                    <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                    ticket en attente
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {d.titre}
                    {d.submitter_name && (
                      <span className="text-fg-subtle"> · {d.submitter_name}</span>
                    )}
                  </span>
                  {d.amount_cents !== null && (
                    <span className="tabular-nums shrink-0">
                      <Amount cents={d.amount_cents} />
                    </span>
                  )}
                </li>
              ))}
              {ecrituresRecentes.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 px-3 py-2.5 text-[13px]"
                >
                  <span className="inline-flex items-center rounded-full bg-bg-sunken px-2 py-0.5 text-[10.5px] font-medium text-fg-muted shrink-0">
                    en banque
                  </span>
                  <span className="tabular-nums text-fg-subtle shrink-0">
                    {e.date_ecriture}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {e.description}
                  </span>
                  <span className="tabular-nums shrink-0">
                    <Amount
                      cents={e.amount_cents}
                      tone={e.type === 'recette' ? 'positive' : 'negative'}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function PosteRow({ poste }: { poste: CampPoste }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate text-fg">{poste.categoryName}</span>
        <span className="tabular-nums shrink-0">
          <Amount cents={poste.depenseCents} />
          <span className="text-fg-subtle"> / </span>
          <Amount cents={poste.budgetCents} tone="muted" />
        </span>
      </div>
      <div className="mt-1.5">
        <Jauge done={poste.depenseCents} total={poste.budgetCents} />
      </div>
    </div>
  );
}
