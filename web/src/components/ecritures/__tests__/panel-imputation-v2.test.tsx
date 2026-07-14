// @vitest-environment jsdom
//
// Test d'INTÉGRATION de la restructuration v2 du panneau d'écriture
// (Task 3) : la grille d'imputation passe EN TÊTE (avant les justificatifs),
// l'en-tête est conditionnel (pas de titre/date/montant répétés en mode
// inline), et le statut « banque #… » vit dans le footer.
//
// On teste le câblage / la structure DOM, pas la logique interne de la
// grille (couverte par imputation-grid + ventilate-editor-model) ni les
// services serveur. Dépendances lourdes mockées ; `PanelHeader` reste RÉEL
// (c'est le rendu conditionnel de l'en-tête qu'on vérifie) et
// `ImputationGrid` est stubbé pour un repère DOM stable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

// --- Mocks ------------------------------------------------------------

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const fetchEcritureDetail = vi.fn();
vi.mock('@/lib/actions/ecritures', () => ({
  updateEcriture: vi.fn(),
  updateEcritureField: vi.fn().mockResolvedValue({ ok: true }),
  fetchEcritureDetail: (...args: unknown[]) => fetchEcritureDetail(...args),
}));

// Repère DOM stable pour la grille d'imputation.
vi.mock('@/components/ecritures/imputation-grid', () => ({
  ImputationGrid: () => <div data-testid="imputation-grid" />,
}));

// Sous-composants lourds / dépendants d'actions serveur : stubs neutres.
vi.mock('@/components/ecritures/ecriture-form', () => ({
  EcritureForm: () => <div data-testid="ecriture-form" />,
}));
vi.mock('@/components/ecritures/justificatifs-card', () => ({
  JustificatifsCard: () => <div data-testid="justifs-card" />,
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

describe('EcritureInlinePanel — restructuration v2', () => {
  beforeEach(() => {
    fetchEcritureDetail.mockResolvedValue({
      ecriture: makeEcriture(),
      justifsBundle: { direct: [], viaRemboursement: [] },
      pendingDepots: [],
      shareableDepots: [],
    });
    refresh.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('(a) rend la grille d’imputation AVANT les justificatifs (ordre DOM)', async () => {
    renderPanel(makeEcriture({ status: 'draft', comptaweb_ecriture_id: null }));

    const grid = await screen.findByTestId('imputation-grid');
    const justifs = await screen.findByTestId('justifs-card');

    // La grille précède les justificatifs dans le document.
    const pos = grid.compareDocumentPosition(justifs);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('(b) en mode inline (rowEcriture fournie), ne répète PAS titre/date/montant dans le corps', async () => {
    renderPanel(makeEcriture({ status: 'draft', comptaweb_ecriture_id: null }));
    // On laisse les effets se stabiliser.
    await screen.findByTestId('imputation-grid');

    // Le titre de la ligne n'est pas re-rendu (l'en-tête reste minimal en inline).
    expect(screen.queryByText('Achat fournitures')).toBeNull();
    // Le bouton fermer (✕) reste présent.
    expect(screen.getByRole('button', { name: /replier/i })).toBeTruthy();
  });

  it('(b bis) en mode épinglé (pas de rowEcriture), affiche titre + montant dans l’en-tête', async () => {
    render(
      <EcritureInlinePanel
        ecritureId="ECR-1"
        onCollapse={() => {}}
        categories={categories}
        topCategoryIds={[]}
        unites={unites}
        modesPaiement={modesPaiement}
        activites={activites}
        cartes={cartes}
      />,
    );

    // L'écriture vient du fetch (mode autonome/épinglé) → titre présent.
    expect(await screen.findByText('Achat fournitures')).toBeTruthy();
  });

  it('(c) rend le statut « banque #… » dans le footer', async () => {
    renderPanel(makeEcriture({ status: 'draft', comptaweb_ecriture_id: null, ligne_bancaire_id: 4242 }));

    await screen.findByTestId('imputation-grid');
    await waitFor(() => expect(screen.getByText('#4242')).toBeTruthy());
  });
});
