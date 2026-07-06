import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks doivent être déclarés AVANT l'import du module testé
vi.mock('../db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(async () => null),
    })),
  })),
}));

vi.mock('./remboursements', () => ({
  getRemboursement: vi.fn(),
  updateRemboursement: vi.fn(async () => ({})),
}));

vi.mock('./remboursement-signing', () => ({
  signAndRefreshRemboursementPdf: vi.fn(async () => {}),
}));

vi.mock('../email/remboursement', () => ({
  sendRemboursementStatusChangedEmail: vi.fn(async () => {}),
}));

vi.mock('../log', () => ({
  logError: vi.fn(),
}));

import { applyRemboursementTransition } from './remboursement-transition';
import { getRemboursement, updateRemboursement } from './remboursements';
import { signAndRefreshRemboursementPdf } from './remboursement-signing';
import { sendRemboursementStatusChangedEmail } from '../email/remboursement';

const CTX = {
  groupId: 'g-test',
  role: 'tresorier',
  userId: 'u-tresorier',
  email: 'tresorier@test.com',
  name: 'Trésorier Test',
  scopeUniteIds: [],
};

const FAKE_RBT = {
  id: 'RBT-2026-001',
  group_id: 'g-test',
  status: 'a_traiter',
  ecriture_id: null,
  submitted_by_user_id: 'u-chef',
  nature: 'Transport',
  total_cents: 3200,
  amount_cents: 3200,
  motif_refus: null,
};

describe('applyRemboursementTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRemboursement).mockResolvedValue(FAKE_RBT as never);
    vi.mocked(updateRemboursement).mockResolvedValue(FAKE_RBT as never);
  });

  it('retourne unknown_status pour un statut inexistant', async () => {
    const r = await applyRemboursementTransition(CTX, 'RBT-2026-001', 'foo_bar');
    expect(r).toEqual({ ok: false, reason: 'unknown_status', message: expect.any(String) });
  });

  it('retourne wrong_role si rôle non autorisé', async () => {
    const ctx = { ...CTX, role: 'chef' };
    const r = await applyRemboursementTransition(ctx, 'RBT-2026-001', 'valide_tresorier');
    expect(r).toEqual({ ok: false, reason: 'wrong_role', message: expect.any(String) });
  });

  it('retourne not_found si remboursement absent', async () => {
    vi.mocked(getRemboursement).mockResolvedValue(undefined);
    const r = await applyRemboursementTransition(CTX, 'RBT-INEXISTANT', 'valide_tresorier');
    expect(r).toEqual({ ok: false, reason: 'not_found', message: expect.any(String) });
  });

  it('retourne wrong_source si transition invalide depuis statut courant', async () => {
    vi.mocked(getRemboursement).mockResolvedValue({ ...FAKE_RBT, status: 'termine' } as never);
    const r = await applyRemboursementTransition(CTX, 'RBT-2026-001', 'valide_tresorier');
    expect(r).toEqual({ ok: false, reason: 'wrong_source', message: expect.any(String) });
  });

  it('retourne needs_ecriture pour → termine sans ecriture_id', async () => {
    vi.mocked(getRemboursement).mockResolvedValue({
      ...FAKE_RBT,
      status: 'virement_effectue',
      ecriture_id: null,
    } as never);
    const r = await applyRemboursementTransition(CTX, 'RBT-2026-001', 'termine');
    expect(r).toEqual({ ok: false, reason: 'needs_ecriture', message: expect.any(String) });
  });

  it('accepte → termine quand ecriture_id est renseigné', async () => {
    vi.mocked(getRemboursement).mockResolvedValue({
      ...FAKE_RBT,
      status: 'virement_effectue',
      ecriture_id: 'ECR-001',
    } as never);
    const r = await applyRemboursementTransition(CTX, 'RBT-2026-001', 'termine');
    expect(r).toEqual({ ok: true });
    expect(updateRemboursement).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'g-test' }),
      'RBT-2026-001',
      expect.objectContaining({ status: 'termine' }),
    );
  });

  it('transition nominale valide_tresorier : appelle updateRemboursement', async () => {
    const r = await applyRemboursementTransition(CTX, 'RBT-2026-001', 'valide_tresorier');
    expect(r).toEqual({ ok: true });
    expect(updateRemboursement).toHaveBeenCalledWith(
      { groupId: 'g-test', scopeUniteIds: [] },
      'RBT-2026-001',
      expect.objectContaining({ status: 'valide_tresorier' }),
    );
  });

  it('déclenche signAndRefreshRemboursementPdf pour valide_tresorier', async () => {
    await applyRemboursementTransition(CTX, 'RBT-2026-001', 'valide_tresorier', {
      clientMeta: { ip: '1.2.3.4', userAgent: 'TestAgent/1' },
    });
    expect(signAndRefreshRemboursementPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'g-test',
        rbtId: 'RBT-2026-001',
        signerRole: 'tresorier',
        signerUserId: 'u-tresorier',
        signerEmail: 'tresorier@test.com',
        ip: '1.2.3.4',
        userAgent: 'TestAgent/1',
      }),
    );
  });

  it('déclenche signAndRefreshRemboursementPdf pour valide_rg', async () => {
    const ctx = { ...CTX, role: 'RG', email: 'rg@test.com', name: 'RG Test', userId: 'u-rg' };
    vi.mocked(getRemboursement).mockResolvedValue({
      ...FAKE_RBT,
      status: 'valide_tresorier',
    } as never);
    await applyRemboursementTransition(ctx, 'RBT-2026-001', 'valide_rg');
    expect(signAndRefreshRemboursementPdf).toHaveBeenCalledWith(
      expect.objectContaining({ signerRole: 'RG' }),
    );
  });

  it('pose date_paiement pour virement_effectue', async () => {
    vi.mocked(getRemboursement).mockResolvedValue({
      ...FAKE_RBT,
      status: 'valide_tresorier',
    } as never);
    await applyRemboursementTransition(CTX, 'RBT-2026-001', 'virement_effectue');
    expect(updateRemboursement).toHaveBeenCalledWith(
      expect.anything(),
      'RBT-2026-001',
      expect.objectContaining({ date_paiement: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    );
  });

  it('inclut motif_refus dans l update pour refuse', async () => {
    await applyRemboursementTransition(CTX, 'RBT-2026-001', 'refuse', { motif: 'Doublon' });
    expect(updateRemboursement).toHaveBeenCalledWith(
      expect.anything(),
      'RBT-2026-001',
      expect.objectContaining({ status: 'refuse', motif_refus: 'Doublon' }),
    );
  });

  it('ne notifie pas si acteur = soumetteur', async () => {
    const ctx = { ...CTX, userId: 'u-chef' }; // same as submitted_by_user_id
    await applyRemboursementTransition(ctx, 'RBT-2026-001', 'valide_tresorier');
    expect(sendRemboursementStatusChangedEmail).not.toHaveBeenCalled();
  });
});
