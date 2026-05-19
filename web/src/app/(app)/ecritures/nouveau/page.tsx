// Page de saisie d'une nouvelle écriture — refonte Task 8 (pivot
// miroir strict + MCP-first).
//
// Doctrine : cette page **prépare** une saisie Comptaweb. Elle n'écrit
// jamais en local sans passer par CW d'abord. La logique d'envoi est
// dans le composant client `NouvelleEcritureWizard` qui présente le
// bandeau, le formulaire, et les 3 boutons `CwAssistActions`.

import { PageHeader } from '@/components/layout/page-header';
import { NouvelleEcritureWizard } from '@/components/ecritures/nouvelle-ecriture-wizard';
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
        subtitle="Prépare une saisie Comptaweb — pilote-la depuis Baloo, ouvre CW pré-rempli, ou copie le détail pour saisie manuelle."
      />
      <NouvelleEcritureWizard
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
