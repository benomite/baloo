// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomNav } from './bottom-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(cleanup);

describe('<BottomNav>', () => {
  it('equipier voit Accueil / Déposer / Mes demandes', () => {
    render(<BottomNav role="equipier" />);
    expect(screen.getByText('Accueil')).toBeTruthy();
    expect(screen.getByText('Déposer')).toBeTruthy();
    expect(screen.getByText('Mes demandes')).toBeTruthy();
    expect(screen.queryByText('Plus')).toBeNull();
  });

  it('parent voit Mes reçus, pas Déposer', () => {
    render(<BottomNav role="parent" />);
    expect(screen.getByText('Mes reçus')).toBeTruthy();
    expect(screen.queryByText('Déposer')).toBeNull();
  });

  it('trésorier voit l onglet Plus', () => {
    render(<BottomNav role="tresorier" />);
    expect(screen.getByText('Plus')).toBeTruthy();
  });
});
