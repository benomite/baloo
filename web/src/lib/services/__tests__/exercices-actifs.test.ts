import { describe, it, expect } from 'vitest';
import {
  codeFromLibelle,
  exercicesActifs,
  exercicePourDate,
  type ExerciceCw,
} from '../exercices-actifs';

const LISTE: ExerciceCw[] = [
  { cwId: 34, libelle: 'Sept 2026 - Aout 2027' },
  { cwId: 33, libelle: 'Sept 2025 - Aout 2026' },
  { cwId: 32, libelle: 'Sept 2024 - Aout 2025' },
];

describe('codeFromLibelle', () => {
  it('lit les deux annees du libelle CW', () => {
    expect(codeFromLibelle('Sept 2025 - Aout 2026')).toBe('2025-2026');
  });

  it('tolere la casse et les accents absents (libelles anciens)', () => {
    expect(codeFromLibelle('sept 2016 - aout 2017')).toBe('2016-2017');
  });

  it('rend null sur un libelle inattendu', () => {
    expect(codeFromLibelle('Exercice en cours')).toBeNull();
  });
});

describe('exercicesActifs', () => {
  it('le 01/09 : le nouvel exercice et le precedent, le plus recent dabord', () => {
    const { actifs, avertissement } = exercicesActifs({
      exercicesCw: LISTE,
      now: new Date('2026-09-01T10:00:00Z'),
      dernierExerciceClos: null,
    });
    expect(actifs.map((e) => e.code)).toEqual(['2026-2027', '2025-2026']);
    expect(actifs[0]).toEqual({ code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' });
    expect(avertissement).toBeNull();
  });

  it('le 31/08 : lexercice en cours est encore celui qui se termine', () => {
    const { actifs } = exercicesActifs({
      exercicesCw: LISTE,
      now: new Date('2026-08-31T10:00:00Z'),
      dernierExerciceClos: null,
    });
    expect(actifs.map((e) => e.code)).toEqual(['2025-2026', '2024-2025']);
  });

  it('exercice precedent declare clos -> un seul actif', () => {
    const { actifs } = exercicesActifs({
      exercicesCw: LISTE,
      now: new Date('2026-09-15T10:00:00Z'),
      dernierExerciceClos: '2025-2026',
    });
    expect(actifs.map((e) => e.code)).toEqual(['2026-2027']);
  });

  it('nouvel exercice pas encore cree dans CW -> lancien seul, avec avertissement', () => {
    const { actifs, avertissement } = exercicesActifs({
      exercicesCw: [{ cwId: 33, libelle: 'Sept 2025 - Aout 2026' }],
      now: new Date('2026-09-15T10:00:00Z'),
      dernierExerciceClos: null,
    });
    expect(actifs.map((e) => e.code)).toEqual(['2025-2026']);
    expect(avertissement).toContain('2026-2027');
  });
});

describe('exercicePourDate', () => {
  const { actifs } = exercicesActifs({
    exercicesCw: LISTE,
    now: new Date('2026-09-15T10:00:00Z'),
    dernierExerciceClos: null,
  });

  it('une depense du 24/08/2026 appartient a 2025-2026', () => {
    expect(exercicePourDate(actifs, '2026-08-24')?.cwId).toBe(33);
  });

  it('une depense du 05/09/2026 appartient a 2026-2027', () => {
    expect(exercicePourDate(actifs, '2026-09-05')?.cwId).toBe(34);
  });

  it('une date hors des exercices actifs (exercice clos) rend null', () => {
    expect(exercicePourDate(actifs, '2025-03-10')).toBeNull();
  });
});
