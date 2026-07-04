import Link from 'next/link';
import { Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { TabLink } from '@/components/shared/tab-link';
import { listEcritures } from '@/lib/queries/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes, getTopCategoryIds } from '@/lib/queries/reference';
import { listDepots, listAllAttachableRemboursements, splitJustifPaths } from '@/lib/services/depots';
import { loadRejectedPairKeys } from '@/lib/services/inbox-rejets';
import type { MatchDepot, MatchRemboursement } from '@/lib/services/ecriture-match';
import { EcritureFilters } from '@/components/ecritures/ecriture-filters';
import { ScanDraftsButton } from '@/components/ecritures/scan-drafts-button';
import { FullResyncButton } from '@/components/ecritures/full-resync-button';
import { SyncStatusButton } from '@/components/sync/sync-status-button';
import { ArbitrageBanner } from '@/components/ecritures/arbitrage-banner';
import { listSupprimeeCw, listAgregesRemplaces, listLinkSuggestions } from '@/lib/queries/sync-arbitrage';
import { EcrituresInfiniteList } from '@/components/ecritures/ecritures-infinite-list';
import { EcrituresSection } from '@/components/ecritures/ecritures-section';
import { getCurrentContext } from '@/lib/context';
import { requireComptaAccess } from '@/lib/auth/access';
import { getEcrituresHeaderTotals, currentExercice } from '@/lib/services/overview';
import { EcrituresFinancialHeader } from '@/components/ecritures/ecritures-financial-header';

// Taille de page du chargement progressif (infinite scroll). La première
// page est servie côté serveur ; les suivantes via la server action.
const PAGE_SIZE = 100;

export default async function EcrituresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await getCurrentContext();
  requireComptaAccess(ctx.role);
  const canLink = ctx.role === 'tresorier' || ctx.role === 'RG';
  const params = await searchParams;
  const exercice = currentExercice();
  const filters = {
    type: params.type || undefined,
    unite_id: params.unite_id || undefined,
    category_id: params.category_id || undefined,
    carte_id: params.carte_id || undefined,
    month: params.month || undefined,
    status: params.status || undefined,
    search: params.search || undefined,
    incomplete: params.incomplete === '1',
    from_bank: params.from_bank === '1',
    sans_unite: params.sans_unite === '1',
    limit: PAGE_SIZE,
  };
  // Toutes ces queries sont indépendantes : on les parallélise pour
  // ne payer que le RTT le plus long (au lieu de la somme).
  const [
    aTraiter,
    bouclees,
    categories,
    unites,
    modesPaiement,
    activites,
    cartes,
    topCategoryIds,
    supprimeesCw,
    agregesRemplaces,
    linkSuggestions,
    headerTotals,
    rawMatchDepots,
    rawMatchRembs,
    rawRejectedKeys,
  ] = await Promise.all([
    listEcritures({ ...filters, bucket: 'a_traiter' }),
    listEcritures({ ...filters, bucket: 'bouclees' }),
    listCategories(),
    listUnites(),
    listModesPaiement(),
    listActivites(),
    listCartes(),
    getTopCategoryIds(5),
    listSupprimeeCw(ctx.groupId),
    listAgregesRemplaces(ctx.groupId),
    listLinkSuggestions(ctx.groupId),
    getEcrituresHeaderTotals({ groupId: ctx.groupId }, { exercice }),
    canLink ? listDepots({ groupId: ctx.groupId }, { statut: 'a_traiter' }) : Promise.resolve([]),
    canLink ? listAllAttachableRemboursements({ groupId: ctx.groupId }, { unlinkedOnly: true }) : Promise.resolve([]),
    canLink ? loadRejectedPairKeys(ctx.groupId) : Promise.resolve(new Set<string>()),
  ]);

  const matchDepots: MatchDepot[] = rawMatchDepots.map((d) => ({
    id: d.id,
    amount_cents: d.amount_cents,
    date_estimee: d.date_estimee,
    titre: d.titre,
    uniteCode: d.unite_code ?? null,
    categoryName: d.category_name ?? null,
    justifPaths: splitJustifPaths(d.justif_paths),
  }));
  const matchRembs: MatchRemboursement[] = rawMatchRembs.map((r) => ({
    id: r.id,
    total_cents: r.total_cents,
    date_depense: r.date_depense,
    date_paiement: r.date_paiement,
    demandeur: r.demandeur,
    uniteCode: r.unite_code ?? null,
    status: r.status,
  }));
  const rejectedMatchKeys = Array.from(rawRejectedKeys);

  const presetQS = (preset: 'all' | 'incomplete' | 'from_bank' | 'sans_unite') => {
    const sp = new URLSearchParams();
    if (preset === 'incomplete') sp.set('incomplete', '1');
    if (preset === 'from_bank') sp.set('from_bank', '1');
    if (preset === 'sans_unite') sp.set('sans_unite', '1');
    return sp.toString() ? `?${sp.toString()}` : '';
  };

  return (
    <div>
      <PageHeader
        title="Écritures"
        meta={
          <Link
            href="/budgets"
            className="text-[12.5px] font-medium text-fg-muted hover:text-brand transition-colors inline-flex items-center gap-1"
          >
            <Calculator size={13} strokeWidth={2} />
            Budget
          </Link>
        }
      >
        {canLink && <SyncStatusButton variant="inline" />}
        <FullResyncButton />
        <ScanDraftsButton />
        <Link href="/ecritures/nouveau"><Button>Nouvelle écriture</Button></Link>
      </PageHeader>

      <EcrituresFinancialHeader
        resultatExerciceCents={headerTotals.resultatExerciceCents}
        exercice={headerTotals.exercice}
        entreesExerciceCents={headerTotals.entreesExerciceCents}
        sortiesExerciceCents={headerTotals.sortiesExerciceCents}
        soldeCaisseCents={headerTotals.soldeCaisseCents}
      />

      {/* Tabs underline (style Linear / Stripe) — plus subtil que des
          pill-buttons remplis. Le tab actif a un trait coloré sous le
          texte ; les autres sont muted. */}
      <div className="mb-4 flex flex-wrap gap-6 border-b">
        <TabLink href={`/ecritures${presetQS('all')}`} active={!filters.incomplete && !filters.from_bank && !filters.sans_unite}>
          Toutes
        </TabLink>
        <TabLink href={`/ecritures${presetQS('incomplete')}`} active={!!filters.incomplete}>
          À compléter
        </TabLink>
        <TabLink href={`/ecritures${presetQS('from_bank')}`} active={!!filters.from_bank}>
          Issues de la banque
        </TabLink>
        <TabLink href={`/ecritures${presetQS('sans_unite')}`} active={!!filters.sans_unite}>
          Sans unité
        </TabLink>
      </div>

      <ArbitrageBanner supprimees={supprimeesCw} agregesRemplaces={agregesRemplaces} suggestions={linkSuggestions} />

      <EcritureFilters categories={categories} unites={unites} cartes={cartes} current={params} />

      <EcrituresSection title="À traiter" count={aTraiter.total} defaultCollapsed={false}>
        <EcrituresInfiniteList
          key={`a_traiter:${JSON.stringify(filters)}`}
          initialEcritures={aTraiter.ecritures}
          total={aTraiter.total}
          pageSize={PAGE_SIZE}
          filters={{ ...filters, bucket: 'a_traiter' }}
          categories={categories}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
          matchDepots={matchDepots}
          matchRembs={matchRembs}
          rejectedMatchKeys={rejectedMatchKeys}
          topCategoryIds={topCategoryIds}
        />
      </EcrituresSection>

      <EcrituresSection title="Bouclées" count={bouclees.total} defaultCollapsed={true}>
        <EcrituresInfiniteList
          key={`bouclees:${JSON.stringify(filters)}`}
          initialEcritures={bouclees.ecritures}
          total={bouclees.total}
          pageSize={PAGE_SIZE}
          filters={{ ...filters, bucket: 'bouclees' }}
          categories={categories}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
          matchDepots={matchDepots}
          matchRembs={matchRembs}
          rejectedMatchKeys={rejectedMatchKeys}
          topCategoryIds={topCategoryIds}
        />
      </EcrituresSection>

    </div>
  );
}
