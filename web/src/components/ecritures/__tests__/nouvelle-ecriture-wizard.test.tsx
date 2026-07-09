// @vitest-environment jsdom

// Smoke test du répéteur de ventilations sur `/ecritures/nouveau`
// (Task 7 du pivot multi-ventilation, S0). On ne peut pas driver le vrai
// dev server ici (page protégée par l'auth trésorier) — ce test sert de
// substitut à la vérification manuelle demandée par le brief : il monte
// le composant réel (pas un mock) et vérifie que le répéteur fonctionne
// de bout en bout sans erreur runtime.
//
// Couvre :
//  1. Une seule ligne pré-affichée par défaut (cas mono-catégorie).
//  2. Le bouton "Faire dans CW" est désactivé tant qu'une ligne est
//     incomplète, activé une fois montant + catégorie + unité + activité
//     renseignés.
//  3. "+ Ajouter une ventilation" ajoute une ligne, le bouton "Tout
//     copier" se cache dès qu'il y a >1 ventilation.
//  4. "Supprimer" fait revenir à 1 ligne et réaffiche "Tout copier".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NouvelleEcritureWizard } from '../nouvelle-ecriture-wizard';
import type { Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Camp', type: 'depense', comptaweb_nature: 'Camp', comptaweb_id: 1 },
  { id: 'cat-2', name: 'Réunions', type: 'depense', comptaweb_nature: 'Réunions', comptaweb_id: 2 },
];
const UNITES: Unite[] = [
  { id: 'uni-1', code: 'LJ', name: 'Louveteaux-Jeannettes', couleur: null, branche: null, comptaweb_id: 1 },
];
const MODES: ModePaiement[] = [{ id: 'mp-1', name: 'CB', comptaweb_id: 1 }];
const ACTIVITES: Activite[] = [{ id: 'act-1', name: 'Camp été', comptaweb_id: 1 }];
const CARTES: Carte[] = [];

function renderWizard() {
  return render(
    <NouvelleEcritureWizard
      categories={CATEGORIES}
      topCategoryIds={[]}
      unites={UNITES}
      modesPaiement={MODES}
      activites={ACTIVITES}
      cartes={CARTES}
    />,
  );
}

describe('NouvelleEcritureWizard — répéteur de ventilations', () => {
  afterEach(() => {
    cleanup();
  });

  it('affiche une seule ligne par défaut et désactive le submit tant que la ligne est incomplète', () => {
    renderWizard();
    expect(screen.getByText('Ventilation 1')).toBeTruthy();
    expect(screen.queryByText('Ventilation 2')).toBeNull();
    expect(screen.queryByText('Supprimer')).toBeNull();

    const submit = screen.getByTestId('cw-assist-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('active le submit une fois la ligne complète (montant + catégorie + unité + activité)', () => {
    // `topCategoryIds=[]` fait dégrader `CategoryPicker` vers son
    // fallback <select> simple (pas de chips) — régression trouvée en
    // écrivant ce test : ce fallback ne notifiait pas `onChange`, donc
    // la ligne restait "sans catégorie" pour toujours et ce test ne
    // passait jamais (bouton resté désactivé). Fixé dans CategoryPicker.
    renderWizard();

    // `exact: false` : les labels obligatoires portent un suffixe "*"
    // (cf. `Field` avec `required`) qui casse le match texte exact.
    fireEvent.change(screen.getByLabelText('Description', { exact: false }), {
      target: { value: 'Achat matériel' },
    });
    fireEvent.change(screen.getByLabelText('Montant', { exact: false }), {
      target: { value: '42,50' },
    });
    fireEvent.change(screen.getByLabelText('Catégorie', { exact: false }), {
      target: { value: 'cat-1' },
    });
    fireEvent.change(screen.getByLabelText('Unité', { exact: false }), {
      target: { value: 'uni-1' },
    });
    fireEvent.change(screen.getByLabelText('Activité', { exact: false }), {
      target: { value: 'act-1' },
    });

    // Pas de compteur "reste à ventiler" en mode wizard (Fix S0 final
    // review) : le total est dérivé de la somme des lignes, il est donc
    // toujours 0 par construction — rien à afficher.
    expect(screen.queryByText(/Reste à ventiler/)).toBeNull();
    const submit = screen.getByTestId('cw-assist-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it('ajoute une ligne, cache "Tout copier", puis revient à 1 ligne à la suppression', () => {
    renderWizard();

    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();

    fireEvent.click(screen.getByText('+ Ajouter une ventilation'));
    expect(screen.getByText('Ventilation 1')).toBeTruthy();
    expect(screen.getByText('Ventilation 2')).toBeTruthy();
    expect(screen.queryByTestId('cw-assist-copy')).toBeNull();

    const removeButtons = screen.getAllByText('Supprimer');
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[1]);

    expect(screen.queryByText('Ventilation 2')).toBeNull();
    expect(screen.queryByText('Supprimer')).toBeNull();
    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();
  });
});
