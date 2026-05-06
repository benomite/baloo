import { describe, it, expect } from 'vitest';
import { parseOmniboxInput, isOmniboxError } from './caisse-omnibox';
import type { Unite } from '../types';

const UNITES: Unite[] = [
  {
    id: 'u-1',
    code: 'PI-CA',
    name: 'Pionniers-Caravelles',
    branche: 'pi-ca',
    couleur: 'rouge',
    comptaweb_id: null,
  },
  {
    id: 'u-2',
    code: 'LJ',
    name: 'Louveteaux-Jeannettes',
    branche: 'lj',
    couleur: 'orange',
    comptaweb_id: null,
  },
  {
    id: 'u-3',
    code: 'SG',
    name: 'Scouts-Guides',
    branche: 'sg',
    couleur: null,
    comptaweb_id: null,
  },
];

describe('parseOmniboxInput', () => {
  it('parse une entrée signée + libellé + unité par couleur SGDF', () => {
    const r = parseOmniboxInput('+180 extra-job rouges', UNITES);
    expect(isOmniboxError(r)).toBe(false);
    if (isOmniboxError(r)) return;
    expect(r.amount_cents).toBe(18000);
    expect(r.description).toBe('extra-job');
    expect(r.unite_id).toBe('u-1');
    expect(r.unite_match_label).toBe('PI-CA');
  });

  it('parse une sortie via signe négatif', () => {
    const r = parseOmniboxInput('-25 chocolat caravelles', UNITES);
    expect(isOmniboxError(r)).toBe(false);
    if (isOmniboxError(r)) return;
    expect(r.amount_cents).toBe(-2500);
    expect(r.description).toBe('chocolat');
    expect(r.unite_id).toBe('u-1'); // "caravelles" → match partiel name
  });

  it('parse les centimes en virgule française', () => {
    const r = parseOmniboxInput('+12,50 tombola', UNITES);
    expect(isOmniboxError(r)).toBe(false);
    if (isOmniboxError(r)) return;
    expect(r.amount_cents).toBe(1250);
    expect(r.description).toBe('tombola');
    expect(r.unite_id).toBeNull();
  });

  it('matche par code exact (PI-CA)', () => {
    const r = parseOmniboxInput('+50 vente PI-CA', UNITES);
    expect(isOmniboxError(r)).toBe(false);
    if (isOmniboxError(r)) return;
    expect(r.unite_id).toBe('u-1');
    expect(r.description).toBe('vente');
  });

  it('défaut : sans signe = entrée', () => {
    const r = parseOmniboxInput('30 don anonyme', UNITES);
    expect(isOmniboxError(r)).toBe(false);
    if (isOmniboxError(r)) return;
    expect(r.amount_cents).toBe(3000);
    expect(r.description).toBe('don anonyme');
    expect(r.unite_id).toBeNull();
  });

  it('refuse une saisie sans montant', () => {
    const r = parseOmniboxInput('extra-job rouges', UNITES);
    expect(isOmniboxError(r)).toBe(true);
  });

  it('refuse une saisie sans description', () => {
    const r = parseOmniboxInput('+180', UNITES);
    expect(isOmniboxError(r)).toBe(true);
  });

  it('warning si plusieurs unités détectées (garde la première)', () => {
    const r = parseOmniboxInput('+10 truc rouges oranges', UNITES);
    expect(isOmniboxError(r)).toBe(false);
    if (isOmniboxError(r)) return;
    expect(r.unite_id).toBe('u-1');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
