// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BottomNav } from './bottom-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(cleanup);

describe('<BottomNav>', () => {
  it("l'equipier voit Déposer / Demandes / Abandons, sans Plus", () => {
    render(<BottomNav role="equipier" />);
    expect(screen.getByText('Déposer')).toBeTruthy();
    expect(screen.getByText('Demandes')).toBeTruthy();
    expect(screen.getByText('Abandons')).toBeTruthy();
    expect(screen.queryByText('Plus')).toBeNull();
  });

  it('le parent voit seulement Mes reçus', () => {
    render(<BottomNav role="parent" />);
    expect(screen.getByText('Mes reçus')).toBeTruthy();
    expect(screen.queryByText('Déposer')).toBeNull();
    expect(screen.queryByText('Abandons')).toBeNull();
  });

  it("le trésorier voit l'onglet Plus", () => {
    render(<BottomNav role="tresorier" />);
    expect(screen.getByText('Plus')).toBeTruthy();
  });

  it('le clic sur Plus déclenche onOpenMore (ouvre le drawer)', () => {
    const onOpenMore = vi.fn();
    render(<BottomNav role="tresorier" onOpenMore={onOpenMore} />);
    fireEvent.click(screen.getByLabelText("Plus d'options"));
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });
});
