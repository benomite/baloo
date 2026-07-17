// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxItem } from '../combobox';

afterEach(() => {
  cleanup();
});

const ITEMS: ComboboxItem[] = [
  { value: 'a', label: 'Alpha', group: 'Fréquentes' },
  { value: 'b', label: 'Bravo', group: 'Fréquentes' },
  { value: 'c', label: 'Charlie', group: 'Toutes' },
  { value: 'd', label: 'Delta', group: 'Toutes' },
];

describe('Combobox', () => {
  it('affiche le placeholder quand value vide, et le label quand value posée', () => {
    const { rerender } = render(
      <Combobox items={ITEMS} value="" onValueChange={() => {}} placeholder="Choisir" ariaLabel="cat" />,
    );
    expect(screen.getByText('Choisir')).toBeInTheDocument();
    rerender(<Combobox items={ITEMS} value="c" onValueChange={() => {}} placeholder="Choisir" ariaLabel="cat" />);
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('ouvre, filtre à la frappe et sélectionne (onValueChange)', async () => {
    const onChange = vi.fn();
    render(
      <Combobox
        items={ITEMS}
        value=""
        onValueChange={onChange}
        placeholder="Choisir"
        searchPlaceholder="Rechercher"
        ariaLabel="cat"
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Rechercher');
    await userEvent.type(search, 'char');
    expect(await screen.findByText('Charlie')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Charlie'));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('affiche emptyText quand aucun résultat', async () => {
    render(
      <Combobox
        items={ITEMS}
        value=""
        onValueChange={() => {}}
        placeholder="Choisir"
        searchPlaceholder="Rechercher"
        emptyText="Rien trouvé"
        ariaLabel="cat"
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Rechercher');
    await userEvent.type(search, 'zzzz');
    expect(await screen.findByText('Rien trouvé')).toBeInTheDocument();
  });

  it('rend les libellés de groupe', async () => {
    render(<Combobox items={ITEMS} value="" onValueChange={() => {}} placeholder="Choisir" ariaLabel="cat" />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Fréquentes')).toBeInTheDocument();
    expect(screen.getByText('Toutes')).toBeInTheDocument();
  });
});
