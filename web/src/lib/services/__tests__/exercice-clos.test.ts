import { describe, it, expect } from 'vitest';
import { parseExerciceClosInput } from '../exercice-clos';

describe('parseExerciceClosInput', () => {
  it('accepte un format valide', () => {
    expect(parseExerciceClosInput('2025-2026')).toEqual({ ok: true, valeur: '2025-2026' });
  });

  it('un champ vide rouvre l’exercice (valeur null)', () => {
    expect(parseExerciceClosInput('')).toEqual({ ok: true, valeur: null });
  });

  it('un champ ne contenant que des blancs rouvre l’exercice (valeur null)', () => {
    expect(parseExerciceClosInput('   ')).toEqual({ ok: true, valeur: null });
  });

  it('refuse une seule année', () => {
    expect(parseExerciceClosInput('2025')).toEqual({
      ok: false,
      erreur: 'Format attendu : 2025-2026.',
    });
  });

  it('refuse une seconde année sur 2 chiffres', () => {
    expect(parseExerciceClosInput('2025-26')).toEqual({
      ok: false,
      erreur: 'Format attendu : 2025-2026.',
    });
  });

  it('refuse une saisie non numérique', () => {
    expect(parseExerciceClosInput('abc')).toEqual({
      ok: false,
      erreur: 'Format attendu : 2025-2026.',
    });
  });

  it('refuse un séparateur incorrect', () => {
    expect(parseExerciceClosInput('2025_2026')).toEqual({
      ok: false,
      erreur: 'Format attendu : 2025-2026.',
    });
  });

  it('accepte une saisie valide entourée d’espaces (trim)', () => {
    expect(parseExerciceClosInput(' 2025-2026 ')).toEqual({ ok: true, valeur: '2025-2026' });
  });
});
