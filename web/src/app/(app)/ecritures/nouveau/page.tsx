import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { createEcriture } from '@/lib/actions/ecritures';
import {
  listCategories,
  listUnites,
  listModesPaiement,
  listActivites,
  listCartes,
  getTopCategoryIds,
} from '@/lib/queries/reference';

export default async function NouvelleEcriturePage() {
  const [categories, topCategoryIds, unites, modesPaiement, activites, cartes] = await Promise.all([
    listCategories(),
    getTopCategoryIds(5),
    listUnites(),
    listModesPaiement(),
    listActivites(),
    listCartes(),
  ]);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Écritures', href: '/ecritures' }}
        title="Nouvelle écriture"
        subtitle="Créer une écriture comptable manuelle (sans passer par l'import bancaire)."
      />
      <EcritureForm
        action={createEcriture}
        categories={categories}
        topCategoryIds={topCategoryIds}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
      />
    </div>
  );
}
