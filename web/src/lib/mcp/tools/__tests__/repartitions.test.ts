import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerRepartitionsTools } from '../repartitions';

const FAKE_REP = {
  id: 'rep-abc123-def4',
  group_id: 'g-test',
  date_repartition: '2026-01-15',
  saison: '2025-2026',
  montant_cents: 120000,
  unite_source_id: null,
  unite_cible_id: 'u-castors',
  libelle: 'Dotation camp été Castors',
  notes: null,
  created_at: '2026-01-15T09:00:00Z',
  updated_at: '2026-01-15T09:00:00Z',
};

vi.mock('@/lib/services/repartitions', () => {
  class RepartitionValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RepartitionValidationError';
    }
  }
  return {
    listRepartitions: vi.fn(async () => [FAKE_REP]),
    createRepartition: vi.fn(async () => FAKE_REP),
    updateRepartition: vi.fn(async () => FAKE_REP),
    deleteRepartition: vi.fn(async () => true),
    RepartitionValidationError,
  };
});

describe('repartitions tools (Lot 2)', () => {
  const tools = captureTools(registerRepartitionsTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 4 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_repartition',
      'delete_repartition',
      'list_repartitions',
      'update_repartition',
    ]);
  });

  it('list_repartitions retourne un tableau JSON avec montants formatés', async () => {
    const r = await tools.list_repartitions.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string; montant: string }>;
    expect(parsed[0].id).toBe('rep-abc123-def4');
    expect(parsed[0].montant).toMatch(/1200,00/);
  });

  it('list_repartitions accepte un filtre saison', async () => {
    const { listRepartitions } = await import('@/lib/services/repartitions');
    await tools.list_repartitions.handler({ saison: '2025-2026' });
    expect(vi.mocked(listRepartitions)).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      { saison: '2025-2026' },
    );
  });

  it('create_repartition parse le montant et retourne la répartition créée', async () => {
    const r = await tools.create_repartition.handler({
      date_repartition: '2026-01-15',
      saison: '2025-2026',
      montant: '1 200,00',
      unite_source_id: null,
      unite_cible_id: 'u-castors',
      libelle: 'Dotation camp été Castors',
    });
    const parsed = parseToolResult(r) as { id: string; montant: string };
    expect(parsed.id).toBe('rep-abc123-def4');
    expect(parsed.montant).toMatch(/1200,00/);
  });

  it('create_repartition passe les bons args au service', async () => {
    const { createRepartition } = await import('@/lib/services/repartitions');
    await tools.create_repartition.handler({
      date_repartition: '2026-01-15',
      saison: '2025-2026',
      montant: '1 200',
      unite_source_id: null,
      unite_cible_id: 'u-castors',
      libelle: 'Dotation camp été Castors',
    });
    expect(vi.mocked(createRepartition)).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      expect.objectContaining({
        montant_cents: 120000,
        unite_source_id: null,
        unite_cible_id: 'u-castors',
        libelle: 'Dotation camp été Castors',
      }),
    );
  });

  it('create_repartition remonte une erreur de validation', async () => {
    const { createRepartition, RepartitionValidationError } = await import('@/lib/services/repartitions');
    vi.mocked(createRepartition).mockRejectedValueOnce(
      new RepartitionValidationError("Une répartition d'une unité vers elle-même n'a pas de sens."),
    );
    const r = await tools.create_repartition.handler({
      date_repartition: '2026-01-15',
      saison: '2025-2026',
      montant: '500',
      unite_source_id: 'u-castors',
      unite_cible_id: 'u-castors',
      libelle: 'Invalide',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('Erreur de validation');
  });

  it('update_repartition parse le montant et retourne la répartition mise à jour', async () => {
    const r = await tools.update_repartition.handler({
      id: 'rep-abc123-def4',
      montant: '750,00',
      libelle: 'Dotation modifiée',
    });
    const parsed = parseToolResult(r) as { id: string; montant: string };
    expect(parsed.id).toBe('rep-abc123-def4');
    expect(parsed.montant).toMatch(/1200,00/);
  });

  it('update_repartition retourne un message si introuvable', async () => {
    const { updateRepartition } = await import('@/lib/services/repartitions');
    vi.mocked(updateRepartition).mockResolvedValueOnce(null);
    const r = await tools.update_repartition.handler({
      id: 'rep-inconnu',
      libelle: 'Test',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('introuvable');
  });

  it('update_repartition remonte une erreur de validation', async () => {
    const { updateRepartition, RepartitionValidationError } = await import('@/lib/services/repartitions');
    vi.mocked(updateRepartition).mockRejectedValueOnce(
      new RepartitionValidationError('Montant invalide.'),
    );
    const r = await tools.update_repartition.handler({
      id: 'rep-abc123-def4',
      montant: '0',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('Erreur de validation');
  });

  it('delete_repartition confirme la suppression', async () => {
    const r = await tools.delete_repartition.handler({ id: 'rep-abc123-def4' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('rep-abc123-def4');
    expect(txt).toContain('supprimée');
  });

  it('delete_repartition retourne un message si introuvable', async () => {
    const { deleteRepartition } = await import('@/lib/services/repartitions');
    vi.mocked(deleteRepartition).mockResolvedValueOnce(false);
    const r = await tools.delete_repartition.handler({ id: 'rep-inconnu' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('introuvable');
  });

  it('delete_repartition passe bien le groupId au service', async () => {
    const { deleteRepartition } = await import('@/lib/services/repartitions');
    await tools.delete_repartition.handler({ id: 'rep-abc123-def4' });
    expect(vi.mocked(deleteRepartition)).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      'rep-abc123-def4',
    );
  });
});
