// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CampTabs } from '../camp-tabs';

afterEach(cleanup);

const panneaux = {
  depenses: <p>panneau dépenses</p>,
  recettes: <p>panneau recettes</p>,
  bilan: <p>panneau bilan</p>,
};

const visible = (texte: string) => screen.getByText(texte).closest('div.hidden') === null;

describe('<CampTabs>', () => {
  it('affiche les trois onglets', () => {
    render(<CampTabs {...panneaux} statut="en_cours" />);
    expect(screen.getByRole('tab', { name: 'Dépenses' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Recettes' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Bilan' })).toBeTruthy();
  });

  it('ouvre sur Dépenses tant que le camp n’est pas clôturé', () => {
    render(<CampTabs {...panneaux} statut="en_cours" />);
    expect(screen.getByRole('tab', { name: 'Dépenses' }).getAttribute('aria-selected')).toBe('true');
    expect(visible('panneau dépenses')).toBe(true);
    expect(visible('panneau bilan')).toBe(false);
  });

  it('ouvre sur Bilan quand le camp est clôturé', () => {
    render(<CampTabs {...panneaux} statut="cloture" />);
    expect(screen.getByRole('tab', { name: 'Bilan' }).getAttribute('aria-selected')).toBe('true');
    expect(visible('panneau bilan')).toBe(true);
    expect(visible('panneau dépenses')).toBe(false);
  });

  it('le clic bascule d’onglet sans démonter les panneaux', () => {
    render(<CampTabs {...panneaux} statut="en_cours" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Bilan' }));
    expect(visible('panneau bilan')).toBe(true);
    expect(visible('panneau dépenses')).toBe(false);
    expect(screen.getByText('panneau dépenses')).toBeTruthy();
  });
});
