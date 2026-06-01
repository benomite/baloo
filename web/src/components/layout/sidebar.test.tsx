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

describe('<Sidebar> — groupe Comptabilité + bloc Administration repliable', () => {
  it('un admin voit Écritures (groupe Comptabilité, toujours visible)', () => {
    render(<Sidebar role="tresorier" />);
    expect(screen.getByText('Écritures')).toBeTruthy();
    expect(screen.getByText('Justificatifs')).toBeTruthy();
  });

  it('le bloc Administration (système) est replié par défaut', () => {
    render(<Sidebar role="tresorier" />);
    expect(screen.getByRole('button', { name: /administration/i })).toBeTruthy();
    // Replié par défaut : Configs Comptaweb n'est pas rendu.
    expect(screen.queryByText('Configs Comptaweb')).toBeNull();
  });

  it('cliquer sur Administration déplie les items système', () => {
    render(<Sidebar role="tresorier" />);
    fireEvent.click(screen.getByRole('button', { name: /administration/i }));
    expect(screen.getByText('Configs Comptaweb')).toBeTruthy();
  });

  it("un chef ne voit ni Comptabilité ni Administration", () => {
    render(<Sidebar role="chef" />);
    expect(screen.queryByText('Écritures')).toBeNull();
    expect(screen.queryByRole('button', { name: /administration/i })).toBeNull();
  });
});
