import Link from 'next/link';
import { Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { TabLink } from '@/components/shared/tab-link';
import { listEcritures, getEcriture } from '@/lib/queries/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes, getTopCategoryIds } from '@/lib/queries/reference';
import { listJustificatifsForEcriture } from '@/lib/queries/justificatifs';
import { listDepots } from '@/lib/services/depots';
import { EcritureFilters } from '@/components/ecritures/ecriture-filters';
import { ScanDraftsButton } from '@/components/ecritures/scan-drafts-button';
import { FullResyncButton } from '@/components/ecritures/full-resync-button';
import { ArbitrageBanner } from '@/components/ecritures/arbitrage-banner';
import { listSupprimeeCw, listAgregesRemplaces, listLinkSuggestions } from '@/lib/queries/sync-arbitrage';
import { EcrituresInfiniteList } from '@/components/ecritures/ecritures-infinite-list';
import { EcritureDrawer } from '@/components/ecritures/ecriture-drawer';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';

// Taille de page du chargement progressif (infinite scroll). La première
// page est servie côté serveur ; les suivantes via la server action.
const PAGE_SIZE = 100;

export default async function EcrituresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await getCurrentContext();
  requireNotParent(ctx.role);
  const params = await searchParams;
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
  const detailId = params.detail || undefined;
  const [
    { ecritures, total },
    categories,
    unites,
    modesPaiement,
    activites,
    cartes,
    topCategoryIds,
    detailEcriture,
    detailJustifs,
    detailPendingDepots,
    supprimeesCw,
    agregesRemplaces,
    linkSuggestions,
  ] = await Promise.all([
    listEcritures(filters),
    listCategories(),
    listUnites(),
    listModesPaiement(),
    listActivites(),
    listCartes(),
    getTopCategoryIds(5),
    detailId ? getEcriture(detailId) : Promise.resolve(undefined),
    detailId
      ? listJustificatifsForEcriture(detailId)
      : Promise.resolve(null),
    detailId
      ? listDepots({ groupId: ctx.groupId }, { statut: 'a_traiter' })
      : Promise.resolve(null),
    listSupprimeeCw(ctx.groupId),
    listAgregesRemplaces(ctx.groupId),
    listLinkSuggestions(ctx.groupId),
  ]);

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
        <FullResyncButton />
        <ScanDraftsButton />
        <Link href="/ecritures/nouveau"><Button>Nouvelle écriture</Button></Link>
      </PageHeader>

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

      <p className="text-sm text-muted-foreground mb-4">{total} écriture{total > 1 ? 's' : ''}</p>

      <EcrituresInfiniteList
        key={JSON.stringify(filters)}
        initialEcritures={ecritures}
        total={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        categories={categories}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
      />

      {detailEcriture && detailJustifs && detailPendingDepots && (
        <EcritureDrawer
          ecriture={detailEcriture}
          justifsBundle={detailJustifs}
          pendingDepots={detailPendingDepots}
          categories={categories}
          topCategoryIds={topCategoryIds}
          unites={unites}
          modesPaiement={modesPaiement}
          activites={activites}
          cartes={cartes}
        />
      )}
    </div>
  );
}
