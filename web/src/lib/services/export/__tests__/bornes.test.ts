import { describe, it, expect } from 'vitest';
import { bornesPourExercice } from '../bornes';

describe('bornesPourExercice', () => {
  it('borne un exercice SGDF du 01/09 au 31/08', () => {
    expect(bornesPourExercice('2025-2026')).toEqual({
      exercice: '2025-2026',
      debut: '2025-09-01',
      fin: '2026-08-31',
      finInclusiveTs: '2026-08-31T23:59:59Z',
    });
  });

  it('refuse un code d\'exercice malformé', () => {
    expect(() => bornesPourExercice('2025')).toThrow(/Exercice invalide/);
  });
});
