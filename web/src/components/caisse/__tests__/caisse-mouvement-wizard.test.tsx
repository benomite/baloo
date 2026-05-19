// @vitest-environment jsdom

// Tests du composant CaisseMouvementWizard — Task 9 du pivot miroir strict.
//
// Doctrine : la caisse reste une saisie locale (CW ne supporte pas
// l'écriture caisse via scraping). Le wizard ajoute :
//   - Un bandeau d'info "pense à reporter dans CW".
//   - Un bouton "Tout copier" qui formatte le mouvement en texte
//     prêt-à-coller dans Comptaweb.
//   - PAS de bouton "Faire dans CW pour moi" (CW ne le supporte pas).
//   - PAS de deep-link CW.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CaisseMouvementWizard } from '../caisse-mouvement-wizard';
import type { Unite, Activite } from '@/lib/types';

const UNITES: Unite[] = [
  {
    id: 'u-rouges',
    code: 'rouges',
    name: 'Rouges',
    couleur: 'rouge',
    branche: 'pionniers',
    comptaweb_id: null,
  },
];

const ACTIVITES: Activite[] = [
  { id: 'a-camp', name: 'Camp été 2026', comptaweb_id: null },
];

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return { writeText };
}

const noopAction = vi.fn();

describe('CaisseMouvementWizard', () => {
  beforeEach(() => {
    mockClipboard();
  });

  afterEach(() => {
    cleanup();
  });

  it('rend le bandeau d\'info Comptaweb (saisie locale + double saisie CW)', () => {
    render(
      <CaisseMouvementWizard
        unites={UNITES}
        activites={ACTIVITES}
        defaultDate="2026-05-19"
        createMouvementAction={noopAction}
      />,
    );
    const banner = screen.getByTestId('caisse-cw-info-banner');
    expect(banner).toBeTruthy();
    // Mentionne explicitement que Baloo enregistre + qu'il faut reporter dans CW.
    expect(banner.textContent).toMatch(/enregistré dans Baloo/i);
    expect(banner.textContent).toMatch(/Comptaweb/i);
  });

  it('rend uniquement le bouton "Tout copier" — pas de submit CW ni deeplink', () => {
    render(
      <CaisseMouvementWizard
        unites={UNITES}
        activites={ACTIVITES}
        defaultDate="2026-05-19"
        createMouvementAction={noopAction}
      />,
    );
    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();
    expect(screen.queryByTestId('cw-assist-submit')).toBeNull();
    expect(screen.queryByTestId('cw-assist-deeplink')).toBeNull();
  });

  it('garde le formulaire local fonctionnel (champs sens, montant, date, description)', () => {
    render(
      <CaisseMouvementWizard
        unites={UNITES}
        activites={ACTIVITES}
        defaultDate="2026-05-19"
        createMouvementAction={noopAction}
      />,
    );
    expect((screen.getByLabelText(/Sens/i) as HTMLSelectElement).name).toBe('sens');
    expect((screen.getByLabelText(/Montant/i) as HTMLInputElement).name).toBe('montant');
    expect((screen.getByLabelText(/Date/i) as HTMLInputElement).name).toBe(
      'date_mouvement',
    );
    expect((screen.getByLabelText(/Description/i) as HTMLInputElement).name).toBe(
      'description',
    );
  });

  it('format clipboard reflète les valeurs courantes du form (entrée, 50€, libellé)', async () => {
    const { writeText } = mockClipboard();
    render(
      <CaisseMouvementWizard
        unites={UNITES}
        activites={ACTIVITES}
        defaultDate="2026-05-19"
        createMouvementAction={noopAction}
      />,
    );

    // L'utilisateur remplit le form.
    fireEvent.change(screen.getByLabelText(/Montant/i), {
      target: { value: '50,00' },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'Quête camp été' },
    });

    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/CAISSE/);
    expect(text).toMatch(/Date\s*:\s*19\/05\/2026/);
    expect(text).toMatch(/Type\s*:\s*Entrée d'espèces/);
    expect(text).toMatch(/Montant\s*:\s*50,00\s*€/);
    expect(text).toMatch(/Libellé\s*:\s*Quête camp été/);
  });

  it('format clipboard bascule en "Sortie" si l\'utilisateur change le sens', async () => {
    const { writeText } = mockClipboard();
    render(
      <CaisseMouvementWizard
        unites={UNITES}
        activites={ACTIVITES}
        defaultDate="2026-05-19"
        createMouvementAction={noopAction}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Sens/i), {
      target: { value: 'sortie' },
    });
    fireEvent.change(screen.getByLabelText(/Montant/i), {
      target: { value: '25,00' },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'Achat chocolat caravelles' },
    });

    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/Type\s*:\s*Sortie d'espèces/);
    expect(text).toMatch(/Montant\s*:\s*25,00\s*€/);
    // Pas de signe négatif dans le clipboard, le sens est porté par "Type".
    expect(text).not.toMatch(/-25,00/);
  });

  it("inclut l'unité sélectionnée dans le clipboard (libellé code)", async () => {
    const { writeText } = mockClipboard();
    render(
      <CaisseMouvementWizard
        unites={UNITES}
        activites={ACTIVITES}
        defaultDate="2026-05-19"
        createMouvementAction={noopAction}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Montant/i), {
      target: { value: '180,00' },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'Extra-job rouges' },
    });
    fireEvent.change(screen.getByLabelText(/Unité/i), {
      target: { value: 'u-rouges' },
    });

    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/Unité\s*:\s*rouges/);
  });
});
