// @vitest-environment jsdom
//
// Garde-fou de PRÉSERVATION de donnée (règle projet : jamais écraser une
// valeur saisie). En mode `multiCategory`, le champ « Catégorie » unique
// devient trompeur (chaque ligne du groupe a sa propre catégorie) : on
// affiche « Catégories multiples » en lecture seule, MAIS on conserve la
// catégorie propre de la tête via un input caché `name="category_id"` —
// sinon un submit du panneau écraserait `category_id` en null. Ce test
// monte le VRAI `EcritureFormFields` (pas de mock du composant testé).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EcritureFormFields } from '../ecriture-form';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

afterEach(() => {
  cleanup();
});

const categories = [
  { id: 'c-head', name: 'Intendance', comptaweb_nature: null, comptaweb_id: 1 },
  { id: 'c-2', name: 'Pharmacie', comptaweb_nature: null, comptaweb_id: 2 },
] as unknown as Category[];
const unites = [{ id: 'u1', code: 'FAR', name: 'Farfadets', comptaweb_id: 1 }] as unknown as Unite[];
const activites = [{ id: 'a1', name: 'Camps', comptaweb_id: 1 }] as unknown as Activite[];
const modesPaiement = [{ id: 'm1', name: 'CB', comptaweb_id: 1 }] as unknown as ModePaiement[];
const cartes = [] as unknown as Carte[];

function makeEcriture(over: Partial<Ecriture> = {}): Ecriture {
  return {
    id: 'ECR-1',
    group_id: 'g1',
    unite_id: 'u1',
    date_ecriture: '2026-07-13',
    description: 'Achat fournitures',
    amount_cents: 1064,
    type: 'depense',
    category_id: 'c-head',
    mode_paiement_id: 'm1',
    activite_id: 'a1',
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
    created_at: '2026-07-13',
    updated_at: '2026-07-13',
    ...over,
  };
}

function renderFields(multiCategory: boolean | undefined) {
  return render(
    <EcritureFormFields
      categories={categories}
      topCategoryIds={[]}
      unites={unites}
      modesPaiement={modesPaiement}
      activites={activites}
      cartes={cartes}
      ecriture={makeEcriture()}
      {...(multiCategory === undefined ? {} : { multiCategory })}
    />,
  );
}

describe('EcritureFormFields — préservation category_id en multiCategory', () => {
  it('multiCategory=true : « Catégories multiples » + hidden input conserve la catégorie de la tête', () => {
    const { container } = renderFields(true);

    // Libellé lecture seule affiché.
    expect(screen.getByText(/Catégories multiples/i)).toBeTruthy();

    // Le champ category_id existe TOUJOURS (input caché) et porte la valeur
    // de la tête → aucun écrasement en null au submit.
    const hidden = container.querySelector('input[name="category_id"]') as HTMLInputElement | null;
    expect(hidden).toBeTruthy();
    expect(hidden!.value).toBe('c-head');

    // Pas de sélecteur de catégorie éditable dans ce mode.
    expect(container.querySelector('select[name="category_id"]')).toBeNull();
  });

  it('multiCategory=false : sélecteur de catégorie normal, pas de « Catégories multiples »', () => {
    const { container } = renderFields(false);

    expect(screen.queryByText(/Catégories multiples/i)).toBeNull();
    // topCategoryIds=[] → CategoryPicker dégrade vers un <select name="category_id">.
    const select = container.querySelector('select[name="category_id"]') as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    expect(select!.value).toBe('c-head');
    // Pas de hidden input « de préservation » ici (le select porte la valeur).
    expect(container.querySelector('input[name="category_id"]')).toBeNull();
  });

  it('multiCategory absent (défaut) : comportement identique à false', () => {
    const { container } = renderFields(undefined);
    expect(screen.queryByText(/Catégories multiples/i)).toBeNull();
    expect(container.querySelector('select[name="category_id"]')).toBeTruthy();
  });
});
