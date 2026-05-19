// @vitest-environment jsdom

// Tests du composant CwAssistActions (Task 8 du pivot miroir strict).
//
// Doctrine : on teste l'interface utilisateur uniquement — pas la
// résolution scraper, pas le formatage CW. Les tests vérifient :
//   1. Rendu conditionnel des 3 boutons selon les props fournies.
//   2. Le clic sur "Faire dans CW" appelle bien `onSubmitToCw(payload)`.
//   3. Le clic sur "Tout copier" écrit dans le clipboard (mocké).
//   4. Les états pending / success / error sont visibles dans le DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  CwAssistActions,
  type CwAssistPayload,
  type CwAssistSubmitResult,
} from '../cw-assist-actions';

const VALID_PAYLOAD: CwAssistPayload = {
  date_ecriture: '2026-05-18',
  description: 'Achat fournitures',
  amount_cents: 4250,
  type: 'depense',
  category_id: 'cat-1',
  mode_paiement_id: 'mp-1',
  unite_id: 'u-1',
  activite_id: 'act-1',
  numero_piece: 'FACT-001',
};

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return { writeText };
}

describe('CwAssistActions', () => {
  beforeEach(() => {
    // Reset clipboard mock entre tests.
    mockClipboard();
  });

  afterEach(() => {
    // Sans `globals: true` dans vitest config, le auto-cleanup de
    // testing-library n'est pas branché → on le fait à la main pour éviter
    // que les composants montés persistent entre tests.
    cleanup();
  });

  it('rend 3 boutons (submit + deeplink + copy) quand toutes les props sont fournies', () => {
    render(
      <CwAssistActions
        payload={VALID_PAYLOAD}
        onSubmitToCw={vi.fn()}
        deepLinkUrl="https://example.com/cw/nouveau?..."
      />,
    );
    expect(screen.getByTestId('cw-assist-submit')).toBeTruthy();
    expect(screen.getByTestId('cw-assist-deeplink')).toBeTruthy();
    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();
  });

  it('cache le bouton submit si `onSubmitToCw` est absent (page édition sans CW write)', () => {
    render(
      <CwAssistActions payload={VALID_PAYLOAD} deepLinkUrl="https://example.com" />,
    );
    expect(screen.queryByTestId('cw-assist-submit')).toBeNull();
    expect(screen.getByTestId('cw-assist-deeplink')).toBeTruthy();
    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();
  });

  it('cache le bouton deeplink si `deepLinkUrl` est absent', () => {
    render(<CwAssistActions payload={VALID_PAYLOAD} onSubmitToCw={vi.fn()} />);
    expect(screen.queryByTestId('cw-assist-deeplink')).toBeNull();
    expect(screen.getByTestId('cw-assist-submit')).toBeTruthy();
    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();
  });

  it('garde "Tout copier" même sans onSubmitToCw ni deepLinkUrl (fallback ultime)', () => {
    render(<CwAssistActions payload={VALID_PAYLOAD} />);
    expect(screen.getByTestId('cw-assist-copy')).toBeTruthy();
    expect(screen.queryByTestId('cw-assist-submit')).toBeNull();
    expect(screen.queryByTestId('cw-assist-deeplink')).toBeNull();
  });

  it('clic sur "Faire dans CW" appelle onSubmitToCw avec le payload', async () => {
    const onSubmitToCw = vi.fn<(p: CwAssistPayload) => Promise<CwAssistSubmitResult>>(
      async () => ({ ok: true, ecriture_id: 'DEP-1' }),
    );
    render(<CwAssistActions payload={VALID_PAYLOAD} onSubmitToCw={onSubmitToCw} />);

    fireEvent.click(screen.getByTestId('cw-assist-submit'));
    await waitFor(() => {
      expect(onSubmitToCw).toHaveBeenCalledOnce();
    });
    expect(onSubmitToCw).toHaveBeenCalledWith(VALID_PAYLOAD);
  });

  it('affiche état pending pendant la promesse, puis success', async () => {
    let resolveSubmit!: (r: CwAssistSubmitResult) => void;
    const onSubmitToCw = vi.fn<(p: CwAssistPayload) => Promise<CwAssistSubmitResult>>(
      () =>
        new Promise<CwAssistSubmitResult>((res) => {
          resolveSubmit = res;
        }),
    );

    render(<CwAssistActions payload={VALID_PAYLOAD} onSubmitToCw={onSubmitToCw} />);
    fireEvent.click(screen.getByTestId('cw-assist-submit'));

    // Pending visible : libellé bouton change, success/error pas encore là.
    await waitFor(() => {
      expect(screen.getByTestId('cw-assist-submit').textContent).toMatch(/envoi/i);
    });
    expect(screen.queryByTestId('cw-assist-success')).toBeNull();
    expect(screen.queryByTestId('cw-assist-error')).toBeNull();

    // Résolution → success visible.
    resolveSubmit({ ok: true, ecriture_id: 'DEP-1' });
    await waitFor(() => {
      expect(screen.getByTestId('cw-assist-success')).toBeTruthy();
    });
    expect(screen.queryByTestId('cw-assist-error')).toBeNull();
  });

  it('affiche le message d\'erreur du 502 dans la zone error', async () => {
    const onSubmitToCw = vi.fn<(p: CwAssistPayload) => Promise<CwAssistSubmitResult>>(
      async () => ({
        ok: false,
        error: 'Mapping CW de la catégorie manquant',
        ecriture_id: 'DEP-X',
        fallback_status: 'draft',
      }),
    );
    render(<CwAssistActions payload={VALID_PAYLOAD} onSubmitToCw={onSubmitToCw} />);

    fireEvent.click(screen.getByTestId('cw-assist-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('cw-assist-error')).toBeTruthy();
    });
    expect(screen.getByTestId('cw-assist-error').textContent).toMatch(
      /mapping cw de la catégorie manquant/i,
    );
  });

  it('appelle onSuccess en cas d\'OK et onError en cas de KO', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    // OK case.
    const { unmount } = render(
      <CwAssistActions
        payload={VALID_PAYLOAD}
        onSubmitToCw={async () => ({ ok: true, ecriture_id: 'DEP-1' })}
        onSuccess={onSuccess}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByTestId('cw-assist-submit'));
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ ok: true, ecriture_id: 'DEP-1' });
    });
    expect(onError).not.toHaveBeenCalled();
    unmount();

    // KO case.
    onSuccess.mockClear();
    onError.mockClear();
    render(
      <CwAssistActions
        payload={VALID_PAYLOAD}
        onSubmitToCw={async () => ({
          ok: false,
          error: 'boom',
          ecriture_id: 'DEP-X',
        })}
        onSuccess={onSuccess}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByTestId('cw-assist-submit'));
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('clic sur "Tout copier" appelle navigator.clipboard.writeText avec un texte multi-lignes', async () => {
    const { writeText } = mockClipboard();
    render(<CwAssistActions payload={VALID_PAYLOAD} />);

    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce();
    });
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/Dépense/);
    expect(text).toMatch(/18\/05\/2026/);
    expect(text).toMatch(/42,50 €/);
    expect(text).toMatch(/Achat fournitures/);
    expect(text).toMatch(/FACT-001/);
  });

  it('affiche feedback "Copié" après clic, puis revient à l\'idle', async () => {
    vi.useFakeTimers();
    mockClipboard();
    render(<CwAssistActions payload={VALID_PAYLOAD} />);

    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await vi.waitFor(() => {
      expect(screen.queryByTestId('cw-assist-copy-feedback')).toBeTruthy();
    });

    vi.advanceTimersByTime(2500);
    await vi.waitFor(() => {
      expect(screen.queryByTestId('cw-assist-copy-feedback')).toBeNull();
    });
    vi.useRealTimers();
  });

  it('utilise formatForClipboard si fourni', async () => {
    const { writeText } = mockClipboard();
    render(
      <CwAssistActions
        payload={VALID_PAYLOAD}
        formatForClipboard={(p) => `CUSTOM:${p.description}:${p.amount_cents}`}
      />,
    );
    fireEvent.click(screen.getByTestId('cw-assist-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('CUSTOM:Achat fournitures:4250');
    });
  });

  it('lien deeplink ouvre dans un nouvel onglet', () => {
    render(
      <CwAssistActions
        payload={VALID_PAYLOAD}
        deepLinkUrl="https://example.com/cw/nouveau?date=2026-05-18"
      />,
    );
    const link = screen.getByTestId('cw-assist-deeplink') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.href).toBe('https://example.com/cw/nouveau?date=2026-05-18');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });
});
