// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryPicker, type CategoryOption } from '../category-picker';

afterEach(() => {
  cleanup();
});

const cats: CategoryOption[] = [
  { id: 'freq1', name: 'Intendance', type: 'depense' },
  { id: 'x', name: 'Carburant', type: 'depense' },
  { id: 'rec1', name: 'Cotisations SGDF', type: 'recette' },
  { id: 'both', name: 'Flux structures', type: 'les_deux' },
  { id: 'loc', name: 'Loyer', type: 'depense', unmapped: true },
];

describe('CategoryPicker', () => {
  it('liste les Fréquentes avant Toutes, sans doublon', async () => {
    render(<CategoryPicker categories={cats} topIds={['freq1']} name="category_id" />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Fréquentes')).toBeInTheDocument();
    expect(screen.getByText('Toutes')).toBeInTheDocument();
    // 'Intendance' apparaît une seule fois (dans Fréquentes)
    expect(screen.getAllByText('Intendance')).toHaveLength(1);
  });

  it('filtre par sens (dépense) : cache la recette pure, garde les_deux', async () => {
    render(<CategoryPicker categories={cats} topIds={[]} name="category_id" sens="depense" />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Flux structures')).toBeInTheDocument();
    expect(screen.queryByText('Cotisations SGDF')).not.toBeInTheDocument();
  });

  it('garde la catégorie sélectionnée même hors sens', async () => {
    render(
      <CategoryPicker categories={cats} topIds={[]} name="category_id" sens="depense" defaultValue="rec1" />,
    );
    // fermé : le déclencheur montre la valeur
    expect(screen.getByText('Cotisations SGDF')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox'));
    // ouverte : elle est toujours présente dans la liste
    expect(await screen.findAllByText('Cotisations SGDF')).not.toHaveLength(0);
  });

  it('met à jour le hidden input et appelle onChange', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <CategoryPicker categories={cats} topIds={[]} name="category_id" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Carburant'));
    expect(onChange).toHaveBeenCalledWith('x');
    const hidden = container.querySelector('input[name="category_id"]') as HTMLInputElement;
    expect(hidden.value).toBe('x');
  });

  it('permet de choisir Aucune', async () => {
    const onChange = vi.fn();
    render(
      <CategoryPicker categories={cats} topIds={[]} name="category_id" defaultValue="x" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Aucune'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('décore les catégories non sync', async () => {
    render(<CategoryPicker categories={cats} topIds={[]} name="category_id" />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText(/Loyer \(non sync\)/)).toBeInTheDocument();
  });
});
