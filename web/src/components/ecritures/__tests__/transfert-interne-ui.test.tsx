// @vitest-environment jsdom
//
// Transfert interne (#51) côté écran :
//  - la carte « Nature de l'opération » qualifie le brouillon et lie / crée
//    l'opération de caisse ;
//  - une ligne de transfert dans le tableau ne réclame ni unité, ni catégorie,
//    ni activité, ni justificatif, ni mode de paiement ;
//  - le formulaire d'édition garde le type « Transfert interne » ;
//  - « Tout copier » donne les champs du formulaire Comptaweb.

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Ecriture, Category, Unite, ModePaiement, Activite, Carte } from '@/lib/types';

const actions = vi.hoisted(() => ({
  qualifierEcriture: vi.fn(),
  fetchCaissePourTransfert: vi.fn(),
  lierOperationCaisse: vi.fn(),
  creerOperationCaisseDepuisEcriture: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/transfert-interne', () => actions);
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock('@/lib/actions/ecritures', () => ({ updateEcritureField: vi.fn(async () => ({ ok: true })) }));
vi.mock('../ecriture-inline-panel', () => ({ EcritureInlinePanel: () => null }));
vi.mock('../ecriture-match-banner', () => ({ EcritureMatchBanner: () => null }));
vi.mock('../batch-edit-bar', () => ({ BatchEditBar: () => null }));

import { TransfertInterneCard } from '../transfert-interne-card';
import { EcrituresTable } from '../ecritures-table';
import { EcritureFormFields } from '../ecriture-form';
import { CwAssistActions } from '../cw-assist-actions';

afterEach(() => cleanup());
beforeEach(() => {
  for (const f of Object.values(actions)) f.mockReset();
  toastError.mockReset();
});

function makeEcriture(over: Partial<Ecriture> = {}): Ecriture {
  return {
    id: 'E1', group_id: 'g1', unite_id: null, date_ecriture: '2026-10-03', description: 'Dépôt camp',
    amount_cents: 25000, type: 'transfert_interne', mode_transfert: 'depot_especes', category_id: null,
    mode_paiement_id: null, activite_id: null, numero_piece: null, status: 'draft', justif_attendu: 0,
    comptaweb_synced: 0, ligne_bancaire_id: 4242, ligne_bancaire_sous_index: null, comptaweb_ecriture_id: null,
    ventilation_group_id: null, carte_id: null, libelle_origine: null, notes: null,
    created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
    has_justificatif: false, remboursement_id: null,
    ...over,
  };
}

const DEPOT = { id: 'DES-1', group_id: 'g1', date_depot: '2026-10-03', total_amount_cents: 25000, ecriture_id: null };
const RETRAIT = { id: 'CAI-9', date_mouvement: '2026-10-05', amount_cents: 8000, type: 'retrait', status: 'saisi' };

describe('TransfertInterneCard', () => {
  it('affiche la nature courante et qualifie le brouillon au changement', async () => {
    actions.qualifierEcriture.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<TransfertInterneCard ecriture={makeEcriture({ type: 'recette', mode_transfert: null })} onChanged={onChanged} />);
    const select = screen.getByLabelText('Nature de l’opération') as HTMLSelectElement;
    expect(select.value).toBe('recette');
    expect(actions.fetchCaissePourTransfert).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: 'retrait_especes' } });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(actions.qualifierEcriture).toHaveBeenCalledWith('E1', 'retrait_especes');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('échec de la qualification : message, pas de rafraîchissement', async () => {
    actions.qualifierEcriture.mockResolvedValue({ ok: false, message: 'Refusé.' });
    const onChanged = vi.fn();
    render(<TransfertInterneCard ecriture={makeEcriture({ type: 'depense', mode_transfert: null })} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Nature de l’opération'), { target: { value: 'depot_especes' } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Refusé.'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('dépôt déjà lié : montre l’opération de la caisse (même montant, même date)', async () => {
    actions.fetchCaissePourTransfert.mockResolvedValue({
      liee: { kind: 'depot', depot: { ...DEPOT, ecriture_id: 'E1' } }, depotsEnAttente: [], retraitsEnAttente: [],
    });
    render(<TransfertInterneCard ecriture={makeEcriture()} onChanged={vi.fn()} />);
    const liee = await screen.findByTestId('operation-caisse-liee');
    expect(liee).toHaveTextContent('Lié au dépôt DES-1 du 2026-10-03');
    expect(liee).toHaveTextContent('250,00');
    expect(screen.queryByText(/Créer le/)).toBeNull();
  });

  it('dépôt à lier : bouton « Lier » sur le dépôt en attente, puis rechargement', async () => {
    actions.fetchCaissePourTransfert.mockResolvedValue({ liee: null, depotsEnAttente: [DEPOT], retraitsEnAttente: [] });
    actions.lierOperationCaisse.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<TransfertInterneCard ecriture={makeEcriture()} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: /Lier/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(actions.lierOperationCaisse).toHaveBeenCalledWith('E1', 'DES-1');
    await waitFor(() => expect(actions.fetchCaissePourTransfert).toHaveBeenCalledTimes(2));
  });

  it('retrait sans opération : propose de créer le retrait dans la caisse', async () => {
    actions.fetchCaissePourTransfert.mockResolvedValue({ liee: null, depotsEnAttente: [], retraitsEnAttente: [RETRAIT] });
    actions.creerOperationCaisseDepuisEcriture.mockResolvedValue({ ok: true });
    render(<TransfertInterneCard ecriture={makeEcriture({ mode_transfert: 'retrait_especes' })} onChanged={vi.fn()} />);
    expect(await screen.findByText('CAI-9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Créer le retrait dans la caisse/ }));
    await waitFor(() => expect(actions.creerOperationCaisseDepuisEcriture).toHaveBeenCalledWith('E1'));
  });

  it('transfert d’espèces : pas de bloc caisse', () => {
    render(<TransfertInterneCard ecriture={makeEcriture({ mode_transfert: 'transfert_especes' })} onChanged={vi.fn()} />);
    expect(screen.queryByText('Caisse')).toBeNull();
    expect(actions.fetchCaissePourTransfert).not.toHaveBeenCalled();
  });
});

describe('EcrituresTable — ligne de transfert interne', () => {
  const categories = [{ id: 'cat-1', name: 'Cotisations' } as Category];
  const unites = [{ id: 'u-1', code: 'LJ', name: 'Louveteaux' } as Unite];
  const modesPaiement = [{ id: 'mp-1', name: 'Chèque' } as ModePaiement];
  const activites = [{ id: 'act-1', name: 'Week-end' } as Activite];
  const renderTable = (ecritures: Ecriture[]) =>
    render(
      <EcrituresTable
        ecritures={ecritures} categories={categories} unites={unites} modesPaiement={modesPaiement}
        activites={activites} cartes={[]} matchDepots={[]} matchRembs={[]} rejectedMatchKeys={[]}
        topCategoryIds={[]} refreshRow={vi.fn()} validatingIds={new Set()} onValidate={vi.fn()}
      />,
    );

  it('montre le mode du transfert, sans unité, catégorie, activité, justificatif ni mode de paiement', () => {
    renderTable([makeEcriture()]);
    expect(screen.getByTestId('row-transfert-E1')).toHaveTextContent('Transfert interne — Dépôt d’espèces (caisse → banque)');
    for (const t of ['+ Unité', '+ Catégorie', '+ Activité', 'sans justif', '+ Mode']) {
      expect(screen.queryByText(t)).toBeNull();
    }
  });

  it('une recette garde ses champs à compléter', () => {
    renderTable([makeEcriture({ type: 'recette', mode_transfert: null })]);
    expect(screen.queryByTestId('row-transfert-E1')).toBeNull();
    expect(screen.getByText('+ Unité')).toBeInTheDocument();
    expect(screen.getByText('+ Mode')).toBeInTheDocument();
  });
});

describe('EcritureFormFields — type « Transfert interne »', () => {
  const renderForm = (e: Ecriture) =>
    render(
      <EcritureFormFields
        categories={[]} topCategoryIds={[]} unites={[]} modesPaiement={[]} activites={[]}
        cartes={[] as Carte[]} ecriture={e}
      />,
    );

  it('un transfert garde son type à l’enregistrement', () => {
    const { container } = renderForm(makeEcriture());
    const select = container.querySelector('select[name="type"]') as HTMLSelectElement;
    expect(select.value).toBe('transfert_interne');
  });

  it('une dépense ne se voit pas proposer le transfert dans ce formulaire', () => {
    const { container } = renderForm(makeEcriture({ type: 'depense', mode_transfert: null }));
    expect(container.querySelector('option[value="transfert_interne"]')).toBeNull();
  });
});

describe('CwAssistActions — « Tout copier » d’un transfert interne', () => {
  it('copie le type et le mode tels que dans le formulaire Comptaweb', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    render(
      <CwAssistActions
        payload={{
          date_ecriture: '2026-10-03', description: 'Dépôt camp', amount_cents: 25000,
          type: 'transfert_interne', mode_transfert: 'retrait_especes',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const texte = writeText.mock.calls[0][0] as string;
    expect(texte.split('\n').slice(0, 3)).toEqual([
      'Type        : Transfert interne à la structure',
      'Mode        : Caisse (retrait)',
      'Date        : 03/10/2026',
    ]);
  });

  it('une dépense n’a pas de ligne « Mode »', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    render(<CwAssistActions payload={{ date_ecriture: '2026-10-03', description: 'Achat', amount_cents: 100, type: 'depense' }} />);
    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain('Mode');
    expect(writeText.mock.calls[0][0]).toContain('Type        : Dépense');
  });
});
