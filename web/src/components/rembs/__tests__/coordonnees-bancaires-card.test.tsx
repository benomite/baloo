// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoordonneesBancairesCard } from '../coordonnees-bancaires-card';

describe('CoordonneesBancairesCard (C1)', () => {
  it('affiche le texte IBAN et le lien fichier RIB', () => {
    render(<CoordonneesBancairesCard ribTexte="FR76 1234" ribFiles={[{ id: 'j1', original_filename: 'rib.pdf', file_path: 'remboursement_rib/RBT-1/rib.pdf' }]} />);
    expect(screen.getByText(/FR76 1234/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /rib\.pdf/ })).toHaveAttribute('href', '/api/justificatifs/remboursement_rib/RBT-1/rib.pdf');
  });
  it('affiche un message discret si aucune coordonnée', () => {
    render(<CoordonneesBancairesCard ribTexte={null} ribFiles={[]} />);
    expect(screen.getByText(/aucune coordonnée/i)).toBeInTheDocument();
  });
});
