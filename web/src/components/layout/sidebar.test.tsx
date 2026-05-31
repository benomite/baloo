// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/depot',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('<Sidebar> — bloc Administration repliable', () => {
  it('un admin voit le bouton Administration, items masqués par défaut', () => {
    render(<Sidebar role="tresorier" />);
    expect(screen.getByRole('button', { name: /administration/i })).toBeTruthy();
    // Replié par défaut : l'item Écritures n'est pas rendu.
    expect(screen.queryByText('Écritures')).toBeNull();
  });

  it('cliquer sur Administration déplie les items', () => {
    render(<Sidebar role="tresorier" />);
    fireEvent.click(screen.getByRole('button', { name: /administration/i }));
    expect(screen.getByText('Écritures')).toBeTruthy();
    expect(screen.getByText('Configs Comptaweb')).toBeTruthy();
  });

  it("un chef ne voit pas le bloc Administration", () => {
    render(<Sidebar role="chef" />);
    expect(screen.queryByRole('button', { name: /administration/i })).toBeNull();
  });
});
