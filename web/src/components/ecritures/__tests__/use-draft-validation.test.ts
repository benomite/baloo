// @vitest-environment jsdom

// Orchestration de la validation d'un draft (hook useDraftValidation).
// Contrat (UX terrain 2026-06-29) :
//   - pendant le push, l'id est dans `validatingIds` (ligne verrouillée) ;
//   - au succès → onValidated(id) (le parent retire la ligne), pas de toast ;
//   - à l'échec → toast d'erreur, onValidated NON appelé, id déverrouillé.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDraftValidation } from '../use-draft-validation';

const syncMock = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/actions/drafts', () => ({
  syncDraftToComptaweb: (...args: unknown[]) => syncMock(...args),
}));
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

describe('useDraftValidation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verrouille pendant le push puis notifie le parent au succès', async () => {
    let resolve!: (v: { ok: boolean; message: string }) => void;
    syncMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const onValidated = vi.fn();
    const { result } = renderHook(() => useDraftValidation(onValidated));

    act(() => { void result.current.validate('DEP-1'); });

    // Verrou immédiat.
    await waitFor(() => expect(result.current.validatingIds.has('DEP-1')).toBe(true));
    expect(syncMock).toHaveBeenCalledWith('DEP-1', { dryRun: false });

    await act(async () => { resolve({ ok: true, message: 'Créée' }); });

    expect(onValidated).toHaveBeenCalledWith('DEP-1');
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.validatingIds.has('DEP-1')).toBe(false);
  });

  it('à l’échec : toast, pas de notif parent, déverrouillage', async () => {
    syncMock.mockResolvedValue({ ok: false, message: 'Comptaweb a refusé.' });
    const onValidated = vi.fn();
    const { result } = renderHook(() => useDraftValidation(onValidated));

    await act(async () => { await result.current.validate('DEP-1'); });

    expect(toastError).toHaveBeenCalledWith('Comptaweb a refusé.');
    expect(onValidated).not.toHaveBeenCalled();
    expect(result.current.validatingIds.has('DEP-1')).toBe(false);
  });

  it('toast générique si l’action jette (Comptaweb injoignable)', async () => {
    syncMock.mockRejectedValue(new Error('network'));
    const onValidated = vi.fn();
    const { result } = renderHook(() => useDraftValidation(onValidated));

    await act(async () => { await result.current.validate('DEP-1'); });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(onValidated).not.toHaveBeenCalled();
    expect(result.current.validatingIds.has('DEP-1')).toBe(false);
  });
});
