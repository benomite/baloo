import { describe, it, expect } from 'vitest';
import { validateRepartitionInput, type RepartitionValidationInput } from './repartitions-validation';

const base: RepartitionValidationInput = {
  date_repartition: '2026-01-15',
  saison: '2025-2026',
  montant_cents: 60000,
  unite_source_id: null,        // = Groupe
  unite_cible_id: 'unt-lj-1',
  libelle: 'Quote-part inscriptions LJ',
};

describe('validateRepartitionInput', () => {
  it('accepte un input valide (Groupe → unité)', () => {
    expect(validateRepartitionInput(base)).toBeNull();
  });

  it('accepte un input valide (unité → unité)', () => {
    expect(validateRepartitionInput({ ...base, unite_source_id: 'unt-sg-1', unite_cible_id: 'unt-lj-1' })).toBeNull();
  });

  it('rejette source = cible (mêmes unités)', () => {
    const err = validateRepartitionInput({ ...base, unite_source_id: 'unt-lj-1', unite_cible_id: 'unt-lj-1' });
    expect(err).toMatch(/source/i);
  });

  it('rejette source et cible NULL (Groupe → Groupe)', () => {
    const err = validateRepartitionInput({ ...base, unite_source_id: null, unite_cible_id: null });
    expect(err).toMatch(/source/i);
  });

  it('rejette montant zéro', () => {
    const err = validateRepartitionInput({ ...base, montant_cents: 0 });
    expect(err).toMatch(/montant/i);
  });

  it('rejette montant négatif', () => {
    const err = validateRepartitionInput({ ...base, montant_cents: -100 });
    expect(err).toMatch(/montant/i);
  });

  it('rejette libellé vide', () => {
    const err = validateRepartitionInput({ ...base, libelle: '' });
    expect(err).toMatch(/libell/i);
  });

  it('rejette libellé whitespace seulement', () => {
    const err = validateRepartitionInput({ ...base, libelle: '   ' });
    expect(err).toMatch(/libell/i);
  });

  it('rejette date au format invalide', () => {
    const err = validateRepartitionInput({ ...base, date_repartition: '15/01/2026' });
    expect(err).toMatch(/date/i);
  });

  it('rejette saison au format invalide', () => {
    const err = validateRepartitionInput({ ...base, saison: '2025' });
    expect(err).toMatch(/saison/i);
  });
});
