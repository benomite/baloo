// @vitest-environment jsdom

// Contrat du bouton « Valider » d'une écriture draft : après une validation
// réussie (push CW), il doit notifier le parent via `onValidated` pour que la
// ligne soit re-fetchée et migre vers le groupe des écritures validées.
// Sans ça, la ligne restait en place jusqu'au rechargement (bug terrain 2026-06).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ValiderCwButton } from '../valider-cw-button';

const syncMock = vi.fn();
vi.mock('@/lib/actions/drafts', () => ({
  syncDraftToComptaweb: (...args: unknown[]) => syncMock(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('ValiderCwButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(cleanup);

  it('appelle onValidated après une validation réussie', async () => {
    syncMock.mockResolvedValue({ ok: true, message: 'Créée' });
    const onValidated = vi.fn();
    render(<ValiderCwButton ecritureId="DEP-1" onValidated={onValidated} />);
    fireEvent.click(screen.getByText('Valider'));
    await waitFor(() => expect(onValidated).toHaveBeenCalledTimes(1));
    expect(syncMock).toHaveBeenCalledWith('DEP-1', { dryRun: false });
  });

  it("n'appelle pas onValidated si la validation échoue", async () => {
    syncMock.mockResolvedValue({ ok: false, message: 'Erreur CW' });
    const onValidated = vi.fn();
    render(<ValiderCwButton ecritureId="DEP-1" onValidated={onValidated} />);
    fireEvent.click(screen.getByText('Valider'));
    await waitFor(() => expect(syncMock).toHaveBeenCalled());
    expect(onValidated).not.toHaveBeenCalled();
  });

  it("n'appelle rien si l'utilisateur annule la confirmation", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    syncMock.mockResolvedValue({ ok: true, message: 'x' });
    const onValidated = vi.fn();
    render(<ValiderCwButton ecritureId="DEP-1" onValidated={onValidated} />);
    fireEvent.click(screen.getByText('Valider'));
    await new Promise((r) => setTimeout(r, 0));
    expect(syncMock).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
  });
});
