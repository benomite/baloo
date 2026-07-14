// @vitest-environment jsdom

// Tests du réagencement du bandeau replié (Task 4 — refonte panneau écriture v2).
//
// Contrat vérifié :
//   (a) le mode de paiement est rendu à DROITE (colonne montant / actions),
//       PAS dans la rangée de chips d'imputation de gauche ;
//   (b) une ligne appartenant à un groupe de ventilation ≥ 2 affiche
//       « Catégories multiples » (non éditable) à la place du sélecteur de
//       catégorie inline, et masque les catégories individuelles.
//
// Harnais : on mocke la server action `updateEcritureField` et les composants
// enfants lourds (panneau inline, bannière de match, barre de batch) qui
// importent des dépendances serveur (`@/lib/actions/*`, `@/lib/db`) — ils ne
// rendent de toute façon rien sur une ligne repliée non sélectionnée.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('@/lib/actions/ecritures', () => ({
  updateEcritureField: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../ecriture-inline-panel', () => ({
  EcritureInlinePanel: () => null,
}));

vi.mock('../ecriture-match-banner', () => ({
  EcritureMatchBanner: () => null,
}));

vi.mock('../batch-edit-bar', () => ({
  BatchEditBar: () => null,
}));

import { EcrituresTable } from '../ecritures-table';
import type { Ecriture, Category, Unite, ModePaiement, Activite } from '@/lib/types';

afterEach(() => cleanup());
beforeEach(() => { seq = 0; });

let seq = 0;
function makeEcriture(over: Partial<Ecriture> = {}): Ecriture {
  seq += 1;
  return {
    id: `ec-${seq}`,
    group_id: 'g-1',
    unite_id: 'u-1',
    date_ecriture: '2026-05-18',
    description: `Écriture ${seq}`,
    amount_cents: 4250,
    type: 'depense',
    category_id: 'cat-1',
    mode_paiement_id: 'mp-1',
    activite_id: 'act-1',
    numero_piece: null,
    status: 'draft',
    justif_attendu: 0,
    comptaweb_synced: 0,
    ligne_bancaire_id: null,
    ligne_bancaire_sous_index: null,
    comptaweb_ecriture_id: null,
    ventilation_group_id: null,
    carte_id: null,
    libelle_origine: null,
    notes: null,
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
    unite_code: 'LJ',
    unite_name: 'Louveteaux-Jeannettes',
    unite_couleur: null,
    category_name: 'Cotisations',
    mode_paiement_name: 'Chèque',
    activite_name: 'Week-end',
    has_justificatif: false,
    remboursement_id: null,
    ...over,
  };
}

const categories: Category[] = [
  { id: 'cat-1', name: 'Cotisations' } as Category,
  { id: 'cat-2', name: 'Dons' } as Category,
];
const unites: Unite[] = [{ id: 'u-1', code: 'LJ', name: 'Louveteaux-Jeannettes' } as Unite];
const modesPaiement: ModePaiement[] = [
  { id: 'mp-1', name: 'Chèque' } as ModePaiement,
  { id: 'mp-2', name: 'Virement' } as ModePaiement,
];
const activites: Activite[] = [{ id: 'act-1', name: 'Week-end' } as Activite];

function renderTable(ecritures: Ecriture[]) {
  return render(
    <EcrituresTable
      ecritures={ecritures}
      categories={categories}
      unites={unites}
      modesPaiement={modesPaiement}
      activites={activites}
      cartes={[]}
      matchDepots={[]}
      matchRembs={[]}
      rejectedMatchKeys={[]}
      topCategoryIds={[]}
      refreshRow={vi.fn()}
      validatingIds={new Set()}
      onValidate={vi.fn()}
    />,
  );
}

describe('EcrituresTable — bandeau replié 2 lignes', () => {
  it('(a) rend le mode de paiement à DROITE (près du montant), pas dans les chips d\'imputation de gauche', () => {
    renderTable([makeEcriture({ mode_paiement_name: 'Chèque', mode_paiement_id: 'mp-1' })]);

    // Le mode existe bien dans le DOM.
    const mode = screen.getByText('Chèque');
    expect(mode).toBeTruthy();

    // Il est DANS la colonne droite (montant + actions).
    const right = screen.getByTestId('row-right-ec-1');
    expect(within(right).queryByText('Chèque')).not.toBeNull();

    // Il n'est PAS dans la rangée de chips d'imputation de gauche.
    const chips = screen.getByTestId('row-chips-ec-1');
    expect(within(chips).queryByText('Chèque')).toBeNull();

    // Les chips de gauche gardent bien unité / catégorie / activité.
    expect(within(chips).queryByText('Cotisations')).not.toBeNull();
    expect(within(chips).queryByText('Week-end')).not.toBeNull();
  });

  it('(b) affiche « Catégories multiples » à la place du picker de catégorie pour une ligne d\'un groupe de ventilation ≥ 2', () => {
    const a = makeEcriture({
      ventilation_group_id: 'vg-1',
      category_id: 'cat-1',
      category_name: 'Cotisations',
      description: 'Facture composite',
    });
    const b = makeEcriture({
      ventilation_group_id: 'vg-1',
      category_id: 'cat-2',
      category_name: 'Dons',
      description: 'Facture composite',
    });
    renderTable([a, b]);

    // Deux lignes du groupe → deux libellés « Catégories multiples ».
    const labels = screen.getAllByText('Catégories multiples');
    expect(labels.length).toBe(2);

    // Les catégories individuelles ne sont PAS affichées comme chip éditable.
    const chipsA = screen.getByTestId(`row-chips-${a.id}`);
    const chipsB = screen.getByTestId(`row-chips-${b.id}`);
    expect(within(chipsA).queryByText('Cotisations')).toBeNull();
    expect(within(chipsB).queryByText('Dons')).toBeNull();

    // « Catégories multiples » vit bien dans la rangée de chips.
    expect(within(chipsA).queryByText('Catégories multiples')).not.toBeNull();
  });

  it('affiche le nudge « + Mode » à droite quand le mode est absent', () => {
    renderTable([makeEcriture({ mode_paiement_id: null, mode_paiement_name: null })]);
    const right = screen.getByTestId('row-right-ec-1');
    expect(within(right).getByText(/\+ Mode/)).toBeTruthy();
  });
});
