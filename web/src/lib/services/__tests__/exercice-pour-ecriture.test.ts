// Route l'écriture vers l'exercice CW de SA date (ADR-039), avec refus AVANT
// tout appel réseau si la date n'appartient à aucun exercice actif — Comptaweb,
// lui, refuse en silence par une redirection (cas terrain 2026-09-11).
import { describe, it, expect, vi } from 'vitest';
import { resoudreExercicePourDate } from '../exercice-pour-ecriture';

const DEPS = {
  lireExercicesCw: async () => [
    { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
    { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
  ],
  lireDernierExerciceClos: async () => null,
  now: () => new Date('2026-09-15T10:00:00Z'),
};

describe('resoudreExercicePourDate', () => {
  it('une dépense de camp datée du 24/08 part sur l’exercice précédent', async () => {
    const ex = await resoudreExercicePourDate('g1', '2026-08-24', DEPS);
    expect(ex.cwId).toBe(33);
  });

  it('une écriture de rentrée datée du 05/09 part sur le nouvel exercice', async () => {
    const ex = await resoudreExercicePourDate('g1', '2026-09-05', DEPS);
    expect(ex.cwId).toBe(34);
  });

  it('exercice déclaré clos → refus, sans appel réseau, avec un message actionnable', async () => {
    const lireExercicesCw = vi.fn(DEPS.lireExercicesCw);
    await expect(
      resoudreExercicePourDate('g1', '2026-08-24', {
        ...DEPS,
        lireExercicesCw,
        lireDernierExerciceClos: async () => '2025-2026',
      }),
    ).rejects.toThrow(/2025-2026.*clos/i);
  });

  it('le message nomme la date et l’exercice concerné', async () => {
    await expect(
      resoudreExercicePourDate('g1', '2024-03-10', DEPS),
    ).rejects.toThrow(/10\/03\/2024/);
  });
});
