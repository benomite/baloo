import { describe, it, expect } from 'vitest';
import { parseHors, horsParam, saisonOptions, HORS_AUCUN } from '../annee-perimetre';

const ACTIVITES = [
  { id: 'act-annee', name: "Activités d'année" },
  { id: 'act-camps', name: 'Camps' },
  { id: 'act-fct', name: 'Fonctionnement' },
];

describe('parseHors', () => {
  it('sans param : exclut les camps par défaut', () => {
    expect(parseHors(undefined, ACTIVITES)).toEqual(['act-camps']);
  });

  it('sentinelle « - » : n’exclut rien (choix explicite de l’utilisateur)', () => {
    expect(parseHors(HORS_AUCUN, ACTIVITES)).toEqual([]);
  });

  it('param vide traité comme aucune exclusion', () => {
    expect(parseHors('', ACTIVITES)).toEqual([]);
  });

  it('respecte une liste explicite', () => {
    expect(parseHors('act-camps,act-fct', ACTIVITES)).toEqual(['act-camps', 'act-fct']);
  });

  it('ignore les ids inconnus (URL bricolée ne doit pas fausser le périmètre)', () => {
    expect(parseHors('act-camps,act-inexistante', ACTIVITES)).toEqual(['act-camps']);
  });

  it('tolère les espaces autour des ids', () => {
    expect(parseHors(' act-camps , act-fct ', ACTIVITES)).toEqual(['act-camps', 'act-fct']);
  });

  it('un groupe sans activité de camp n’exclut rien par défaut', () => {
    expect(parseHors(undefined, [{ id: 'a', name: 'Sorties' }])).toEqual([]);
  });
});

describe('horsParam', () => {
  it('ne produit rien quand le param est absent (préserve le défaut)', () => {
    expect(horsParam(undefined)).toBe('');
  });

  it('reconduit la valeur, sentinelle comprise', () => {
    expect(horsParam(HORS_AUCUN)).toBe('&hors=-');
    expect(horsParam('act-camps,act-fct')).toBe('&hors=act-camps%2Cact-fct');
  });
});

describe('saisonOptions', () => {
  it('en juillet, l’exercice courant est celui qui a commencé en septembre dernier', () => {
    const opts = saisonOptions(new Date('2026-07-28T12:00:00Z'));
    expect(opts[0].value).toBe('2025-2026');
    expect(opts[0].label).toBe('Sept 2025 → Août 2026');
  });

  it('en septembre, on bascule sur le nouvel exercice', () => {
    expect(saisonOptions(new Date('2026-09-01T12:00:00Z'))[0].value).toBe('2026-2027');
  });

  it('propose 4 exercices, du plus récent au plus ancien', () => {
    const opts = saisonOptions(new Date('2026-07-28T12:00:00Z'));
    expect(opts.map((o) => o.value)).toEqual(['2025-2026', '2024-2025', '2023-2024', '2022-2023']);
  });
});
