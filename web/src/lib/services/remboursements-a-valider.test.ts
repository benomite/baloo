import { describe, it, expect } from 'vitest';
import {
  statutAValiderPourRole,
  callbackUrlForRole,
} from './remboursements-a-valider';

describe('statutAValiderPourRole', () => {
  it('tresorier → a_traiter (sa première validation)', () => {
    expect(statutAValiderPourRole('tresorier')).toBe('a_traiter');
  });
  it('RG → valide_tresorier (sa contre-signature)', () => {
    expect(statutAValiderPourRole('RG')).toBe('valide_tresorier');
  });
  it('membre / chef / rôle inconnu → null (ne valide rien)', () => {
    expect(statutAValiderPourRole('membre')).toBeNull();
    expect(statutAValiderPourRole('chef')).toBeNull();
    expect(statutAValiderPourRole('parent')).toBeNull();
    expect(statutAValiderPourRole('')).toBeNull();
  });
});

describe('callbackUrlForRole', () => {
  it('RG → file de validation', () => {
    expect(callbackUrlForRole('RG')).toBe('/remboursements?tab=a-valider');
  });
  it('tous les autres rôles → formulaire de saisie (inchangé)', () => {
    expect(callbackUrlForRole('tresorier')).toBe('/remboursements/nouveau');
    expect(callbackUrlForRole('membre')).toBe('/remboursements/nouveau');
    expect(callbackUrlForRole('chef')).toBe('/remboursements/nouveau');
    expect(callbackUrlForRole('')).toBe('/remboursements/nouveau');
  });
});
