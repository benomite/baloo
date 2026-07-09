// Tests du helper pur de lecture des ventilations — Task 7 du pivot
// multi-ventilation (S0). Aucune dépendance DOM/BDD : pure fonction de
// transformation `VentilationDraft[]` -> payload API / reste à ventiler.

import { describe, it, expect } from 'vitest';
import { ventilationsToPayload, ventilationsRemainderCents } from '../ventilations-form';

describe('ventilationsToPayload', () => {
  it('convertit les lignes en payload cents', () => {
    expect(
      ventilationsToPayload([
        { amount: '70,00', category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' },
      ]),
    ).toEqual([{ amount_cents: 7000, category_id: 'CAT-INT', unite_id: 'UNI-A', activite_id: 'ACT-1' }]);
  });

  it('normalise les chaînes vides en null', () => {
    expect(
      ventilationsToPayload([{ amount: '10,00', category_id: '', unite_id: null, activite_id: '' }]),
    ).toEqual([{ amount_cents: 1000, category_id: null, unite_id: null, activite_id: null }]);
  });

  it('traite un montant vide comme 0', () => {
    expect(
      ventilationsToPayload([{ amount: '', category_id: null, unite_id: null, activite_id: null }]),
    ).toEqual([{ amount_cents: 0, category_id: null, unite_id: null, activite_id: null }]);
  });
});

describe('ventilationsRemainderCents', () => {
  it('calcule le reste à ventiler', () => {
    expect(
      ventilationsRemainderCents(10000, [
        { amount: '70,00', category_id: 'CAT-INT', unite_id: null, activite_id: null },
      ]),
    ).toBe(3000);
  });

  it('retourne 0 quand la somme des lignes couvre le total', () => {
    expect(
      ventilationsRemainderCents(10000, [
        { amount: '70,00', category_id: null, unite_id: null, activite_id: null },
        { amount: '30,00', category_id: null, unite_id: null, activite_id: null },
      ]),
    ).toBe(0);
  });

  it('peut être négatif si les lignes dépassent le total', () => {
    expect(
      ventilationsRemainderCents(1000, [
        { amount: '15,00', category_id: null, unite_id: null, activite_id: null },
      ]),
    ).toBe(-500);
  });
});
