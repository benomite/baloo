// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ImputationGrid } from '../imputation-grid';
import type { VentLine } from '../ventilate-editor-model';

afterEach(() => {
  cleanup();
});

const cats = [{ id: 'c-int', name: 'Intendance' }, { id: 'c-ph', name: 'Pharmacie' }] as never[];
const unites = [{ id: 'u-fa', name: 'Farfadets', code: 'FA' }] as never[];
const activites = [{ id: 'a-camps', name: 'Camps' }] as never[];
const mono: VentLine[] = [{ id: 'l1', amount: '41,24', category_id: null, unite_id: 'u-fa', activite_id: 'a-camps' }];

function setup(over = {}) {
  const onMonoFieldChange = vi.fn();
  const onSaveVentilation = vi.fn().mockResolvedValue(undefined);
  render(
    <ImputationGrid totalCents={4124} initialLines={mono} categories={cats} unites={unites}
      activites={activites} editable onMonoFieldChange={onMonoFieldChange} onSaveVentilation={onSaveVentilation} {...over} />,
  );
  return { onMonoFieldChange, onSaveVentilation };
}

describe('ImputationGrid', () => {
  it('mono : édite un champ → onMonoFieldChange (pas de colonne Montant visible)', () => {
    const { onMonoFieldChange } = setup();
    fireEvent.change(screen.getByLabelText(/Activité ligne 1/i), { target: { value: 'a-camps' } });
    expect(onMonoFieldChange).toHaveBeenCalledWith('activite_id', 'a-camps');
    expect(screen.queryByText(/Enregistrer la ventilation/i)).toBeNull();
    expect(screen.queryByLabelText(/Montant/i)).toBeNull();
  });

  it('« Ajouter un détail » passe en ventilé en place : ligne 1 = total, ligne 2 héritée', () => {
    setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const montants = screen.getAllByLabelText(/Montant/i) as HTMLInputElement[];
    expect(montants).toHaveLength(2);
    expect(montants[0].value).toBe('41,24');
    expect(montants[1].value).toBe('');
    // ligne 2 hérite unité/activité
    expect((screen.getAllByLabelText(/Unité du détail/i)[0] as HTMLSelectElement).value).toBe('u-fa');
    expect((screen.getAllByLabelText(/Activité du détail/i)[0] as HTMLSelectElement).value).toBe('a-camps');
  });

  it('solde vivant : dépasse en rouge, save désactivé', async () => {
    const { onSaveVentilation } = setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const montants = screen.getAllByLabelText(/Montant/i);
    fireEvent.change(montants[1], { target: { value: '10,00' } });
    await waitFor(() => expect(screen.getByText(/dépasse de 10,00/i)).toBeTruthy());
    expect((screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSaveVentilation).not.toHaveBeenCalled();
  });

  it('équilibré + complet → onSaveVentilation reçoit les ventilations résolues', async () => {
    const { onSaveVentilation } = setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const montants = screen.getAllByLabelText(/Montant/i);
    fireEvent.change(montants[0], { target: { value: '31,24' } });
    fireEvent.change(montants[1], { target: { value: '10,00' } });
    fireEvent.change(screen.getAllByLabelText(/Catégorie/i)[0], { target: { value: 'c-int' } });
    fireEvent.change(screen.getAllByLabelText(/Catégorie/i)[1], { target: { value: 'c-ph' } });
    const save = screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(onSaveVentilation).toHaveBeenCalledTimes(1));
    const arg = onSaveVentilation.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg[0]).toMatchObject({ amount_cents: 3124, category_id: 'c-int', unite_id: 'u-fa', activite_id: 'a-camps' });
    expect(arg[1]).toMatchObject({ amount_cents: 1000, category_id: 'c-ph', unite_id: 'u-fa', activite_id: 'a-camps' });
  });

  it('« Catégories multiples » affiché en ventilé (≥2 lignes)', () => {
    setup();
    expect(screen.queryByText(/Catégories multiples/i)).toBeNull();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    expect(screen.getByText(/Catégories multiples/i)).toBeTruthy();
  });

  it('ajouter un 3ᵉ détail hérite de la dernière ligne', () => {
    setup();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const unites2 = screen.getAllByLabelText(/Unité du détail/i) as HTMLSelectElement[];
    expect(unites2).toHaveLength(3);
    // dernière ligne héritée de la ligne 2, elle-même héritée de la ligne 1 (u-fa)
    expect(unites2[2].value).toBe('u-fa');
  });

  it('startVentilated=true rend directement la vue ventilée avec les lignes fournies', () => {
    const lines: VentLine[] = [
      { id: 'x1', amount: '20,00', category_id: 'c-int', unite_id: 'u-fa', activite_id: 'a-camps' },
      { id: 'x2', amount: '21,24', category_id: 'c-ph', unite_id: 'u-fa', activite_id: 'a-camps' },
    ];
    setup({ initialLines: lines, startVentilated: true });
    expect(screen.getAllByLabelText(/Montant/i)).toHaveLength(2);
    expect(screen.getByText(/équilibré/i)).toBeTruthy();
  });
});
