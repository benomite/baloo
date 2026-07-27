import { describe, it, expect } from 'vitest';
import { canConvertRemboursement } from '../convert-guard';

describe('canConvertRemboursement (A2)', () => {
  it('trésorier + a_traiter → true', () => {
    expect(canConvertRemboursement('tresorier', 'a_traiter')).toBe(true);
  });
  it('RG (même à_traiter) → false (trésorier seul)', () => {
    expect(canConvertRemboursement('RG', 'a_traiter')).toBe(false);
  });
  it('trésorier mais déjà validé → false', () => {
    expect(canConvertRemboursement('tresorier', 'valide_tresorier')).toBe(false);
    expect(canConvertRemboursement('tresorier', 'valide_rg')).toBe(false);
    expect(canConvertRemboursement('tresorier', 'virement_effectue')).toBe(false);
  });
});
