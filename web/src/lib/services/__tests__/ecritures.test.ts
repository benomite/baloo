import { describe, it, expect } from 'vitest';
import { computeMissingFields } from '../ecritures';

describe('computeMissingFields — justif via remboursement', () => {
  const base = {
    status: 'mirror',
    category_id: 'c', activite_id: 'a', unite_id: 'u', mode_paiement_id: 'm',
    type: 'depense', numero_piece: 'P1', justif_attendu: 1,
  };
  it('dépense sans justif ni rembt → justif manquant', () => {
    expect(computeMissingFields({ ...base, has_justificatif: false })).toContain('justif');
  });
  it('dépense liée à un remboursement → justif NON manquant', () => {
    expect(
      computeMissingFields({ ...base, has_justificatif: false, remboursement_id: 'RBT-1' }),
    ).not.toContain('justif');
  });
});
