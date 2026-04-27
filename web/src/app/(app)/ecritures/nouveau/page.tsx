import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { createEcriture } from '@/lib/actions/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes } from '@/lib/queries/reference';

export default async function NouvelleEcriturePage() {
  return (
    <div>
      <PageHeader title="Nouvelle écriture" />
      <EcritureForm
        action={createEcriture}
        categories={listCategories()}
        unites={await listUnites()}
        modesPaiement={listModesPaiement()}
        activites={await listActivites()}
        cartes={await listCartes()}
      />
    </div>
  );
}
