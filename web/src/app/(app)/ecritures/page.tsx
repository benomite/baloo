import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { listEcritures } from '@/lib/queries/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes } from '@/lib/queries/reference';
import { EcritureFilters } from '@/components/ecritures/ecriture-filters';
import { ScanDraftsButton } from '@/components/ecritures/scan-drafts-button';
import { EcrituresTable } from '@/components/ecritures/ecritures-table';
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
    limit: 200,
  };
  const { ecritures, total } = await listEcritures(filters);
  const categories = listCategories();
  const unites = await listUnites();
  const modesPaiement = listModesPaiement();
  const activites = await listActivites();
  const cartes = await listCartes();

  const presetQS = (preset: 'all' | 'incomplete' | 'from_bank') => {
    const sp = new URLSearchParams();
    if (preset === 'incomplete') sp.set('incomplete', '1');
    if (preset === 'from_bank') sp.set('from_bank', '1');
    return sp.toString() ? `?${sp.toString()}` : '';
  };

  return (
    <div>
      <PageHeader title="Écritures">
        <ScanDraftsButton />
        <Link href="/ecritures/nouveau"><Button>Nouvelle écriture</Button></Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={`/ecritures${presetQS('all')}`}>
          <Button variant={!filters.incomplete && !filters.from_bank ? 'default' : 'outline'} size="sm">Toutes</Button>
        </Link>
        <Link href={`/ecritures${presetQS('incomplete')}`}>
          <Button variant={filters.incomplete ? 'default' : 'outline'} size="sm">À compléter</Button>
        </Link>
        <Link href={`/ecritures${presetQS('from_bank')}`}>
          <Button variant={filters.from_bank ? 'default' : 'outline'} size="sm">Issues de la banque</Button>
        </Link>
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
    </div>
  );
}
