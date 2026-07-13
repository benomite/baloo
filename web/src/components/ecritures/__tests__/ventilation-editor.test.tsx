// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { VentilationEditor } from '../ventilation-editor';

afterEach(() => {
  cleanup();
});

const cats = [
  { id: 'c-int', name: 'Intendance', comptaweb_nature: null },
  { id: 'c-ph', name: 'Pharmacie', comptaweb_nature: null },
] as never[];
const unites = [{ id: 'u-farfa', name: 'Farfadets' }] as never[];
const activites = [{ id: 'a-camps', name: 'Camps' }] as never[];

function renderEditor(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <VentilationEditor
      totalCents={1064}
      initialDefaults={{ unite_id: 'u-farfa', activite_id: 'a-camps' }}
      initialRows={[{ id: 'r1', amount: '10,64', category_id: 'c-int', override: null }]}
      categories={cats}
      unites={unites}
      activites={activites}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('VentilationEditor', () => {
  it('affiche le total équilibré au départ (1 ligne = total)', () => {
    renderEditor();
    expect(screen.getByText(/équilibré/i)).toBeTruthy();
  });

  it('« + Ajouter un détail » crée une ligne incomplète → bouton désactivé même si le total reste équilibré', () => {
    // NB : la ligne ajoutée a un montant vide (contribue pour 0 à la somme),
    // donc `editorRemainderCents` reste à 0 ici (le total ne bouge pas tant
    // que rien n'a été saisi sur la nouvelle ligne) — l'indicateur affiche
    // toujours « équilibré ». C'est `canSaveVentilation` qui bloque
    // l'enregistrement via le critère de complétude (montant/catégorie
    // manquants sur la nouvelle ligne), indépendamment du solde.
    renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    expect(screen.getByText(/équilibré/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('déséquilibrer un montant → indicateur « à ventiler » + bouton désactivé', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const amounts = screen.getAllByLabelText(/Montant/i);
    // La ligne 1 passe de 10,64 à 7,00 ; la ligne 2 reste vide → il manque
    // réellement 3,64 € à ventiler.
    fireEvent.change(amounts[0], { target: { value: '7,00' } });
    expect(screen.getByText(/à ventiler/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('rééquilibrer + compléter → onSave reçoit les ventilations résolues', async () => {
    const onSave = renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    // ligne 1 → 7,00 ; ligne 2 → 3,64 + catégorie Pharmacie
    const amounts = screen.getAllByLabelText(/Montant/i);
    fireEvent.change(amounts[0], { target: { value: '7,00' } });
    fireEvent.change(amounts[1], { target: { value: '3,64' } });
    // Sélection de la catégorie de la 2ᵉ ligne (CategoryPicker sans favoris
    // retombe sur un <select> natif, cf. category-picker.tsx topCats.length===0).
    fireEvent.change(screen.getAllByLabelText(/Catégorie/i)[1], { target: { value: 'c-ph' } });
    const save = screen.getByRole('button', { name: /Enregistrer la ventilation/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const arg = onSave.mock.calls[0][0];
    expect(arg).toHaveLength(2);
    expect(arg[0]).toMatchObject({ amount_cents: 700, category_id: 'c-int', unite_id: 'u-farfa', activite_id: 'a-camps' });
    expect(arg[1]).toMatchObject({ amount_cents: 364, category_id: 'c-ph' });
  });

  it("un ⚙ permet de surcharger l'imputation d'une seule ligne", () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const toggles = screen.getAllByRole('button', { name: /surcharge/i });
    fireEvent.click(toggles[1]);
    // La ligne surchargée expose 2 selects supplémentaires (Activité + Unité de ligne).
    expect(screen.getAllByLabelText(/Activité/i).length).toBeGreaterThan(1);
    expect(screen.getAllByLabelText(/Unité/i).length).toBeGreaterThan(1);
  });

  it('le ✕ retire une ligne, sauf s\'il n\'en reste qu\'une', () => {
    renderEditor();
    fireEvent.click(screen.getByText('+ Ajouter un détail'));
    const removes = screen.getAllByRole('button', { name: /retirer/i });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[1]);
    expect(screen.getAllByLabelText(/Montant/i)).toHaveLength(1);
    const lastRemove = screen.getByRole('button', { name: /retirer/i }) as HTMLButtonElement;
    expect(lastRemove.disabled).toBe(true);
  });
});
