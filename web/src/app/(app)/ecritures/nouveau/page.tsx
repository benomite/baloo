import { PageHeader } from '@/components/layout/page-header';
import { EcritureForm } from '@/components/ecritures/ecriture-form';
import { createEcriture } from '@/lib/actions/ecritures';
import { listCategories, listUnites, listModesPaiement, listActivites, listCartes } from '@/lib/queries/reference';

export default async function NouvelleEcriturePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        eyebrow={{ label: 'Écritures', href: '/ecritures' }}
        title="Nouvelle écriture"
        subtitle="Créer une écriture comptable manuelle (sans passer par l'import bancaire)."
      />
      <EcritureForm
        action={createEcriture}
        categories={await listCategories()}
        unites={await listUnites()}
        modesPaiement={await listModesPaiement()}
        activites={await listActivites()}
        cartes={await listCartes()}
      />
    </div>
  );
}
