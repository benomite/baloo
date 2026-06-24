import { describe, it, expect } from 'vitest';
import { isAllClear } from '../dashboard';

const base = {
  rembs: { count: 0, totalCents: 0 },
  depotsARapprocher: 0,
  depensesSansJustif: 0,
  abandonsATraiter: 0,
  draftsBancaires: 0,
};

describe('isAllClear', () => {
  it('renvoie true quand tous les compteurs sont à zéro', () => {
    expect(isAllClear(base)).toBe(true);
  });

  it('renvoie false dès qu un compteur est non nul', () => {
    expect(isAllClear({ ...base, depotsARapprocher: 1 })).toBe(false);
    expect(isAllClear({ ...base, rembs: { count: 2, totalCents: 5000 } })).toBe(false);
    expect(isAllClear({ ...base, draftsBancaires: 3 })).toBe(false);
  });
});
