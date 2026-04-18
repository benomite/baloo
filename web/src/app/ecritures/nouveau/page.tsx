import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { createEcriture } from '@/lib/actions/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites } from '@/lib/queries/reference';

export default function NouvelleEcriturePage() {
  return (
    <div>
      <PageHeader title="Nouvelle écriture" />
      <EcritureForm
        action={createEcriture}
        categories={listCategories()}
        unites={listUnites()}
        modesPaiement={listModesPaiement()}
        activites={listActivites()}
      />
    </div>
  );
}
