import { describe, it, expect } from 'vitest';
import {
  abregeExercice,
  exerciceCodeForDate,
  libelleExercicesCouverts,
} from '../exercices-affichage';

describe('exerciceCodeForDate', () => {
  it('une dépense de camp du 24/08 appartient à l’exercice qui se termine', () => {
    expect(exerciceCodeForDate('2026-08-24')).toBe('2025-2026');
  });

  it('le 31/08 est encore dans l’exercice précédent', () => {
    expect(exerciceCodeForDate('2026-08-31')).toBe('2025-2026');
  });

  it('le 01/09 ouvre le nouvel exercice', () => {
    expect(exerciceCodeForDate('2026-09-01')).toBe('2026-2027');
  });

  it('une date de plein hiver appartient à l’exercice commencé en septembre', () => {
    expect(exerciceCodeForDate('2026-03-10')).toBe('2025-2026');
  });

  it('ne dépend pas du fuseau horaire : la chaîne ISO est lue telle quelle', () => {
    // `new Date('2026-09-01')` vaut minuit UTC : dans un fuseau négatif, une
    // lecture via getMonth() rendrait le 31/08, donc le mauvais exercice.
    expect(exerciceCodeForDate('2026-09-01T00:00:00Z'.slice(0, 10))).toBe('2026-2027');
  });
});

describe('abregeExercice', () => {
  it('abrège pour un affichage compact', () => {
    expect(abregeExercice('2025-2026')).toBe('25/26');
  });

  it('rend la valeur telle quelle si le format est inattendu', () => {
    expect(abregeExercice('exercice courant')).toBe('exercice courant');
  });
});

describe('libelleExercicesCouverts', () => {
  it('nomme les deux exercices pendant la période de clôture', () => {
    expect(libelleExercicesCouverts(['2026-2027', '2025-2026'])).toBe('26/27 + 25/26');
  });

  it('rend null avec un seul exercice — onze mois sur douze, il n’y a rien à dire', () => {
    expect(libelleExercicesCouverts(['2026-2027'])).toBeNull();
  });

  it('rend null sans donnée (run antérieur à ADR-039, ou aucun run)', () => {
    expect(libelleExercicesCouverts(null)).toBeNull();
    expect(libelleExercicesCouverts([])).toBeNull();
  });
});
