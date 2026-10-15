// La sync des référentiels doit fusionner les doublons AVANT d'appliquer quoi
// que ce soit (ADR-041). Sinon, lancée avant la migration (le MCP ne passe pas
// par `ensureAuthSchema`), elle rattache les IDs de l'exercice courant aux
// lignes `-2` par leur ancienne colonne comptaweb_id — et la fusion qui suit
// retire ces lignes avec leurs mappings : envois CW refusés jusqu'à la sync
// suivante.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ordre: string[] = [];

vi.mock('../../db', () => ({ getDb: () => ({}) }));
vi.mock('../../ids', () => ({ currentTimestamp: () => '2026-10-15T00:00:00Z' }));
vi.mock('../sync-cycle', () => ({
  decouvrirExercices: vi.fn(async () => [
    { code: '2026-2027', cwId: 2, debut: '2026-09-01', fin: '2027-08-31' },
    { code: '2025-2026', cwId: 1, debut: '2025-09-01', fin: '2026-08-31' },
  ]),
}));
vi.mock('../../comptaweb/sync-referentiels-logic', () => ({
  fusionnerDoublonsReferentiels: vi.fn(async () => {
    ordre.push('fusion');
    return { fusionnees: [], bloquees: [] };
  }),
}));
const STATS = { ajoutees: 0, mappees: 0, inchangees: 0, orphelines: [] };
vi.mock('../../comptaweb', () => ({
  withComptaweb: vi.fn(async (_cwId: number, fn: (cfg: unknown) => unknown) => fn({})),
  fetchReferentielsCreer: vi.fn(async () => ({ brancheprojet: [], nature: [], activite: [], modetransaction: [] })),
  fetchAllCartes: vi.fn(async () => []),
  applyReferentielsSync: vi.fn(async (_db, _g, _refs, _now, exercice: string) => {
    ordre.push(`apply ${exercice}`);
    return { unites: STATS, categories: STATS, activites: STATS, modes_paiement: STATS, cartes: STATS };
  }),
}));

import { syncReferentielsTousExercices } from '../referentiels-sync';

describe('syncReferentielsTousExercices', () => {
  beforeEach(() => {
    ordre.length = 0;
  });

  it("fusionne les doublons avant d'appliquer, puis traite les exercices du plus ancien au plus récent", async () => {
    const report = await syncReferentielsTousExercices('g1');

    expect(ordre).toEqual(['fusion', 'apply 2025-2026', 'apply 2026-2027']);
    expect(report.exercices).toEqual(['2025-2026', '2026-2027']);
  });
});
