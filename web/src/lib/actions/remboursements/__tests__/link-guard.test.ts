import { describe, it, expect } from 'vitest';
import { canLinkEcriture } from '../link-guard';

describe('canLinkEcriture (A3)', () => {
  it('virement_effectue → true', () => {
    expect(canLinkEcriture('virement_effectue')).toBe(true);
  });
  it('termine → true (re-lier / voir le lien)', () => {
    expect(canLinkEcriture('termine')).toBe(true);
  });
  it('avant le virement → false', () => {
    for (const s of ['a_traiter', 'valide_tresorier', 'valide_rg']) {
      expect(canLinkEcriture(s)).toBe(false);
    }
  });
});
