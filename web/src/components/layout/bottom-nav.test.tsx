// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BottomNav } from './bottom-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(cleanup);

describe('<BottomNav>', () => {
  it('le membre voit Déposer / Demandes / Abandons, sans Plus', () => {
    render(<BottomNav role="membre" />);
    expect(screen.getByText('Déposer')).toBeTruthy();
    expect(screen.getByText('Demandes')).toBeTruthy();
    expect(screen.getByText('Abandons')).toBeTruthy();
    expect(screen.queryByText('Plus')).toBeNull();
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
