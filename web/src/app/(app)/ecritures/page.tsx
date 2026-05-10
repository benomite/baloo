import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { TabLink } from '@/components/shared/tab-link';
import { listEcritures, getEcriture } from '@/lib/queries/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes, getTopCategoryIds } from '@/lib/queries/reference';
import { listJustificatifsForEcriture } from '@/lib/queries/justificatifs';
import { listDepots } from '@/lib/services/depots';
import { EcritureFilters } from '@/components/ecritures/ecriture-filters';
import { ScanDraftsButton } from '@/components/ecritures/scan-drafts-button';
import { EcrituresTable } from '@/components/ecritures/ecritures-table';
import { EcritureDrawer } from '@/components/ecritures/ecriture-drawer';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';

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
    limit: 200,
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
      <PageHeader title="Écritures">
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

      <EcritureFilters categories={categories} unites={unites} cartes={cartes} current={params} />

      <p className="text-sm text-muted-foreground mb-4">{total} écriture{total > 1 ? 's' : ''}</p>

      <EcrituresTable
        ecritures={ecritures}
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
