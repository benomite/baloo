// @vitest-environment jsdom
//
// Test d'INTÉGRATION du branchement de l'éditeur de ventilation dans
// `EcritureInlinePanel` (Task 7). On teste le câblage UI, pas la logique
// de résolution (couverte par ventilate-editor-model.test.ts) ni le
// service serveur (couvert côté API). Les dépendances lourdes du panneau
// (actions serveur, sous-composants, next/navigation) sont mockées ;
// `VentilationEditor` reste RÉEL car c'est l'intégration qu'on vérifie.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

// --- Mocks ------------------------------------------------------------

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

// Actions serveur (importées par le panneau). fetchEcritureDetail alimente
// le bloc justificatifs ; on renvoie un bundle vide bien formé.
const fetchEcritureDetail = vi.fn();
vi.mock('@/lib/actions/ecritures', () => ({
  updateEcriture: vi.fn(),
  updateEcritureField: vi.fn().mockResolvedValue({ ok: true }),
  fetchEcritureDetail: (...args: unknown[]) => fetchEcritureDetail(...args),
}));

// Sous-composants lourds / dépendants d'actions serveur : stubs neutres.
vi.mock('@/components/ecritures/ecriture-form', () => ({
  EcritureForm: () => <div data-testid="ecriture-form" />,
}));
vi.mock('@/components/ecritures/justificatifs-card', () => ({
  JustificatifsCard: () => <div data-testid="justifs-card" />,
}));
vi.mock('@/components/ecritures/panel-header', () => ({
  PanelHeader: () => <div data-testid="panel-header" />,
}));
vi.mock('@/components/ecritures/panel-readonly-summary', () => ({
  PanelReadonlySummary: () => <div data-testid="readonly-summary" />,
}));
vi.mock('@/components/ecritures/panel-relance', () => ({
  PanelRelance: () => <div data-testid="panel-relance" />,
}));
vi.mock('@/components/ecritures/cw-assist-actions', () => ({
  CwAssistActions: () => <div data-testid="cw-assist" />,
}));
vi.mock('@/components/ecritures/resync-ecriture-button', () => ({
  ResyncEcritureButton: () => <div data-testid="resync" />,
}));
vi.mock('@/components/ecritures/delete-draft-button', () => ({
  DeleteDraftButton: () => <div data-testid="delete-draft" />,
}));
vi.mock('@/components/ecritures/panel-valider-button', () => ({
  PanelValiderButton: () => <div data-testid="valider" />,
}));
vi.mock('@/components/ecritures/panel-more-menu', () => ({
  PanelMoreMenu: () => <div data-testid="more-menu" />,
}));

import { EcritureInlinePanel } from '../ecriture-inline-panel';

// --- Fixtures ---------------------------------------------------------

const categories = [
  { id: 'c1', name: 'Intendance', comptaweb_nature: null, comptaweb_id: 1 },
  { id: 'c2', name: 'Pharmacie', comptaweb_nature: null, comptaweb_id: 2 },
] as unknown as Category[];
const unites = [{ id: 'u1', code: 'FAR', name: 'Farfadets', comptaweb_id: 1 }] as unknown as Unite[];
const activites = [{ id: 'a1', name: 'Camps', comptaweb_id: 1 }] as unknown as Activite[];
const modesPaiement = [{ id: 'm1', name: 'CB', comptaweb_id: 1 }] as unknown as ModePaiement[];
const cartes = [] as unknown as Carte[];

function makeEcriture(over: Partial<Ecriture> = {}): Ecriture {
  return {
    id: 'ECR-1',
    group_id: 'g1',
    unite_id: 'u1',
    date_ecriture: '2026-07-13',
    description: 'Achat fournitures',
    amount_cents: 1064,
    type: 'depense',
    category_id: 'c1',
    mode_paiement_id: 'm1',
    activite_id: 'a1',
    numero_piece: null,
    status: 'draft',
    justif_attendu: 0,
    comptaweb_synced: 0,
    ligne_bancaire_id: null,
    ligne_bancaire_sous_index: null,
    comptaweb_ecriture_id: null,
    ventilation_group_id: null,
    carte_id: null,
    libelle_origine: null,
    notes: null,
    created_at: '2026-07-13',
    updated_at: '2026-07-13',
    ...over,
  };
}

function renderPanel(ecriture: Ecriture, extra: Record<string, unknown> = {}) {
  return render(
    <EcritureInlinePanel
      ecriture={ecriture}
      ecritureId={ecriture.id}
      onCollapse={() => {}}
      refreshRow={vi.fn()}
      categories={categories}
      topCategoryIds={[]}
      unites={unites}
      modesPaiement={modesPaiement}
      activites={activites}
      cartes={cartes}
      {...extra}
    />,
  );
}

describe('EcritureInlinePanel — branchement ventilation', () => {
  beforeEach(() => {
    fetchEcritureDetail.mockResolvedValue({
      ecriture: makeEcriture(),
      justifsBundle: { direct: [], viaRemboursement: [] },
      pendingDepots: [],
      shareableDepots: [],
    });
    refresh.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('affiche « + Ajouter un détail » sur un draft éditable', async () => {
    renderPanel(makeEcriture({ status: 'draft', comptaweb_ecriture_id: null }));
    expect(await screen.findByTestId('ventilate-trigger')).toBeTruthy();
  });

  it('cache le déclencheur sur une écriture mirror (déjà dans Comptaweb)', async () => {
    renderPanel(makeEcriture({ status: 'mirror', comptaweb_ecriture_id: 123, comptaweb_synced: 1 }));
    // Laisse le fetch/effets se stabiliser.
    await waitFor(() => expect(fetchEcritureDetail).toHaveBeenCalled());
    expect(screen.queryByTestId('ventilate-trigger')).toBeNull();
  });

  it('bascule vers VentilationEditor au clic, puis PUT + router.refresh au save', async () => {
    renderPanel(makeEcriture({ status: 'draft', comptaweb_ecriture_id: null }));

    const trigger = await screen.findByTestId('ventilate-trigger');
    fireEvent.click(trigger);

    // L'éditeur est monté (bloc « Imputation par défaut » + bouton d'enreg).
    expect(await screen.findByText(/Imputation par défaut/i)).toBeTruthy();
    const save = screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement;
    // La ligne unique préremplie porte le montant total + catégorie/unité/
    // activité de la tête → équilibrée et complète → bouton actif d'emblée.
    await waitFor(() => expect(save.disabled).toBe(false));

    fireEvent.click(save);

    await waitFor(() => expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled());
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/ecritures/ECR-1/ventilations');
    expect(call[1].method).toBe('PUT');
    const body = JSON.parse(call[1].body as string);
    expect(Array.isArray(body.ventilations)).toBe(true);
    expect(body.ventilations).toHaveLength(1);
    expect(body.ventilations[0]).toMatchObject({
      amount_cents: 1064,
      category_id: 'c1',
      unite_id: 'u1',
      activite_id: 'a1',
    });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
