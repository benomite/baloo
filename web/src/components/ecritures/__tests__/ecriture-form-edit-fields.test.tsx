// @vitest-environment jsdom
//
// Task 5 (nettoyage EcritureForm — imputation migrée dans `ImputationGrid`) :
// l'imputation (Unité, Catégorie, Activité) ne vit plus dans
// `EcritureFormFields` mode='edit' — elle est rendue par `ImputationGrid`
// dans le panneau. Ce test remplace `ecriture-form-multicategory.test.tsx`
// (comportement `multiCategory` supprimé avec les selects concernés).
//
// Couvre :
//  1. Aucun champ d'imputation (`unite_id`/`category_id`/`activite_id`) n'est
//     rendu en mode 'edit'.
//  2. Les champs d'identité (date, montant, type, carte, notes) restent
//     présents — le panneau d'édition garde ces champs.
//  3. `multiCategory` n'existe plus : passer la prop ne doit rien changer
//     (elle est absente du type), on vérifie juste l'absence des selects.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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
const cartes = [{ id: 'ca1', type: 'cb', porteur: 'Trésorier', code_externe: null, comptaweb_id: 1 }] as unknown as Carte[];

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

function renderEditFields() {
  return render(
    <EcritureFormFields
      categories={categories}
      topCategoryIds={[]}
      unites={unites}
      modesPaiement={modesPaiement}
      activites={activites}
      cartes={cartes}
      ecriture={makeEcriture()}
    />,
  );
}

describe('EcritureFormFields (mode edit) — imputation retirée', () => {
  it("ne rend plus aucun champ d'imputation (unite_id / category_id / activite_id)", () => {
    const { container } = renderEditFields();

    expect(container.querySelector('[name="unite_id"]')).toBeNull();
    expect(container.querySelector('[name="category_id"]')).toBeNull();
    expect(container.querySelector('[name="activite_id"]')).toBeNull();
    expect(container.querySelector('input[type="hidden"][name="category_id"]')).toBeNull();
  });

  it("conserve les champs d'identité : date, montant, type, carte, notes", () => {
    const { container } = renderEditFields();

    expect(container.querySelector('input[name="date_ecriture"]')).toBeTruthy();
    expect(container.querySelector('input[name="montant"]')).toBeTruthy();
    expect(container.querySelector('select[name="type"]')).toBeTruthy();
    expect(container.querySelector('select[name="carte_id"]')).toBeTruthy();
    expect(container.querySelector('textarea[name="notes"]')).toBeTruthy();
  });

  it('conserve le mode de paiement', () => {
    const { container } = renderEditFields();
    expect(container.querySelector('select[name="mode_paiement_id"]')).toBeTruthy();
  });
});
