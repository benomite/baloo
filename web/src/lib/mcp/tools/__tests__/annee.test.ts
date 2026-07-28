import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerAnneeTools } from '../annee';

const FAKE_DATA = {
  exercice: '2025-2026',
  bornes: { start: '2025-09-01', end: '2026-08-31' },
  activitesExclues: [{ id: 'act-camps', name: 'Camps' }],
  parUnite: [
    { unite_id: 'u-pc', code: 'PC', name: 'Pionniers-Caravelles', couleur: 'rouge', recettes: 96558, depenses: 66303, solde: 30255, nb: 13, nb_drafts: 0 },
  ],
  totalRecettes: 96558,
  totalDepenses: 66303,
  solde: 30255,
  totalRecettesFormatted: '965,58 €',
  totalDepensesFormatted: '663,03 €',
  soldeFormatted: '302,55 €',
  nbDrafts: 0,
  dernierImport: { date: '2026-04-19', fichier: 'export.csv' },
  derniereEcriture: '2026-04-30',
};

const ACTIVITES = [
  { id: 'act-annee', name: "Activités d'année" },
  { id: 'act-camps', name: 'Camps' },
];

const getAnneeOverview = vi.fn(async () => FAKE_DATA);
const selectAnneeParActivite = vi.fn(async () => [
  { activite_id: 'act-annee', activite_name: "Activités d'année", recettes: 96558, depenses: 66303, nb: 13 },
]);
const selectAnneeEcritures = vi.fn(async () => [
  { id: 'E1', date_ecriture: '2026-02-19', description: 'Participations WE', amount_cents: 6000, type: 'recette', status: 'mirror', activite_name: "Activités d'année", category_name: 'Participation activités' },
]);

vi.mock('@/lib/services/annee', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/annee')>('@/lib/services/annee');
  return {
    defaultActivitesExcluesIds: actual.defaultActivitesExcluesIds,
    getAnneeOverview: (...a: unknown[]) => getAnneeOverview(...(a as [])),
    selectAnneeParActivite: (...a: unknown[]) => selectAnneeParActivite(...(a as [])),
    selectAnneeEcritures: (...a: unknown[]) => selectAnneeEcritures(...(a as [])),
  };
});

vi.mock('@/lib/services/reference', () => ({
  listActivites: vi.fn(async () => ACTIVITES),
}));

vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }));

describe('tools MCP vue Année', () => {
  beforeEach(() => vi.clearAllMocks());

  const tools = () => captureTools(registerAnneeTools, { groupId: 'g-test' });

  it('expose vue_annee et vue_annee_unite', () => {
    expect(Object.keys(tools()).sort()).toEqual(['vue_annee', 'vue_annee_unite']);
  });

  it('vue_annee renvoie le bilan par unité', async () => {
    const res = await tools()['vue_annee'].handler({});
    expect(parseToolResult(res)).toMatchObject({ exercice: '2025-2026', solde: 30255 });
  });

  it('vue_annee exclut les activités de camp par défaut', async () => {
    await tools()['vue_annee'].handler({});
    expect(getAnneeOverview).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      expect.objectContaining({ excludeActiviteIds: ['act-camps'] }),
    );
  });

  it('vue_annee respecte une liste d’exclusion explicite, vide comprise', async () => {
    await tools()['vue_annee'].handler({ hors_activite_ids: [] });
    expect(getAnneeOverview).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      expect.objectContaining({ excludeActiviteIds: [] }),
    );
  });

  it('vue_annee_unite passe l’unité et les bornes de l’exercice demandé', async () => {
    await tools()['vue_annee_unite'].handler({ unite_id: 'u-pc', exercice: '2024-2025' });
    expect(selectAnneeParActivite).toHaveBeenCalledWith(
      expect.anything(), 'g-test',
      { start: '2024-09-01', end: '2025-08-31' },
      ['act-camps'], 'u-pc',
    );
  });

  it('vue_annee_unite accepte unite_id null pour les non imputées', async () => {
    const res = await tools()['vue_annee_unite'].handler({ unite_id: null });
    expect(selectAnneeEcritures).toHaveBeenCalledWith(
      expect.anything(), 'g-test', expect.anything(), ['act-camps'], null,
    );
    expect(parseToolResult(res)).toMatchObject({ unite_id: null, solde: 30255 });
  });
});
