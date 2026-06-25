import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerEcrituresTools } from '../ecritures';
import { CwPushFailedError, CwLocalUpdateFailedError } from '@/lib/services/ecritures-create';

const listEcrituresMock = vi.fn();
const updateEcritureMock = vi.fn();
const createMock = vi.fn();

vi.mock('@/lib/services/ecritures', () => ({
  listEcritures: (...args: unknown[]) => listEcrituresMock(...args),
  updateEcriture: (...args: unknown[]) => updateEcritureMock(...args),
}));

vi.mock('@/lib/services/ecritures-create', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    createEcritureAndPushToCw: (...args: unknown[]) => createMock(...args),
  };
});

vi.mock('@/lib/services/ecritures-create-cw-adapter', () => ({
  defaultCwScraper: vi.fn(),
}));

vi.mock('@/lib/comptaweb/auth', () => ({
  loadConfig: vi.fn(async () => ({ baseUrl: 'http://x', cookie: 'c' })),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({ prepare: vi.fn() })),
}));

vi.mock('@/lib/services/ecritures-status', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    pendingStatuses: () => ['draft', 'pending_cw', 'pending_sync'] as string[],
  };
});

describe('ecritures tools (Vague 4 — étendus)', () => {
  const tools = captureTools(registerEcrituresTools);

  beforeEach(() => {
    vi.clearAllMocks();
    listEcrituresMock.mockResolvedValue({
      ecritures: [
        {
          id: 'DEP-2026-001',
          status: 'mirror',
          comptaweb_ecriture_id: 12345,
          notes: null,
          justif_attendu: 1,
        },
      ],
      total: 1,
    });
  });

  it('expose list_ecritures + create_ecriture + update_ecriture', () => {
    expect(Object.keys(tools).sort()).toEqual(['create_ecriture', 'list_ecritures', 'update_ecriture']);
  });

  // ─── list_ecritures étendu ─────────────────────────────────────────────

  it('list_ecritures retourne {ecritures, total}', async () => {
    const r = await tools.list_ecritures.handler({});
    const parsed = parseToolResult(r) as { ecritures: Array<{ id: string }>; total: number };
    expect(parsed.ecritures[0].id).toBe('DEP-2026-001');
    expect(parsed.total).toBe(1);
  });

  it('list_ecritures accepte status string ou array', async () => {
    await tools.list_ecritures.handler({ status: 'draft' });
    expect(listEcrituresMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ status: 'draft' }),
    );

    await tools.list_ecritures.handler({ status: ['draft', 'pending_cw'] });
    expect(listEcrituresMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ statusIn: ['draft', 'pending_cw'] }),
    );
  });

  it('list_ecritures pending_only=true mappe sur la sémantique pendingStatuses', async () => {
    await tools.list_ecritures.handler({ pending_only: true });
    expect(listEcrituresMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ statusIn: ['draft', 'pending_cw', 'pending_sync'] }),
    );
  });

  it('list_ecritures accepte carte_id / mode_paiement_id', async () => {
    await tools.list_ecritures.handler({ carte_id: 'carte-cb-x', mode_paiement_id: 'mp-1' });
    expect(listEcrituresMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ carte_id: 'carte-cb-x', mode_paiement_id: 'mp-1' }),
    );
  });

  it('list_ecritures filtre par comptaweb_ecriture_id (post-filter)', async () => {
    const r = await tools.list_ecritures.handler({ comptaweb_ecriture_id: 12345 });
    const parsed = parseToolResult(r) as { ecritures: Array<{ id: string }>; total: number };
    expect(parsed.ecritures).toHaveLength(1);

    const r2 = await tools.list_ecritures.handler({ comptaweb_ecriture_id: 99999 });
    const parsed2 = parseToolResult(r2) as { ecritures: Array<unknown>; total: number };
    expect(parsed2.ecritures).toHaveLength(0);
  });

  // ─── create_ecriture ───────────────────────────────────────────────────

  it('create_ecriture succès → renvoie ecriture en pending_sync', async () => {
    createMock.mockResolvedValue({
      id: 'DEP-2026-002',
      status: 'pending_sync',
      cw_numero_piece: 'CW-X-001',
    });
    const r = await tools.create_ecriture.handler({
      date_ecriture: '2026-05-18',
      description: 'Achat',
      amount_cents: 5000,
      type: 'depense',
    });
    const parsed = parseToolResult(r) as { ok: boolean; ecriture: { id: string; status: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.ecriture.status).toBe('pending_sync');
  });

  it('create_ecriture accepte montant FR via parseAmount', async () => {
    createMock.mockResolvedValue({
      id: 'DEP-2026-003',
      status: 'pending_sync',
      cw_numero_piece: 'CW-X-002',
    });
    await tools.create_ecriture.handler({
      date_ecriture: '2026-05-18',
      description: 'Achat',
      montant: '42,50',
      type: 'depense',
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payload: expect.objectContaining({ amount_cents: 4250 }),
      }),
    );
  });

  it('create_ecriture sans montant renvoie une erreur explicite', async () => {
    const r = await tools.create_ecriture.handler({
      date_ecriture: '2026-05-18',
      description: 'Achat',
      type: 'depense',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('montant manquant');
  });

  it('create_ecriture CwPushFailedError → message draft + hint Tout copier', async () => {
    createMock.mockRejectedValue(new CwPushFailedError('DEP-2026-004', new Error('CW down')));
    const r = await tools.create_ecriture.handler({
      date_ecriture: '2026-05-18',
      description: 'Achat',
      amount_cents: 5000,
      type: 'depense',
    });
    const parsed = parseToolResult(r) as {
      ok: boolean;
      fallback_status: string;
      ecriture_id: string;
      hint: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.fallback_status).toBe('draft');
    expect(parsed.ecriture_id).toBe('DEP-2026-004');
    expect(parsed.hint).toContain('Tout copier');
  });

  it('create_ecriture CwLocalUpdateFailedError → message désynchro grave + ne PAS retry', async () => {
    createMock.mockRejectedValue(
      new CwLocalUpdateFailedError('DEP-2026-005', 'CW-Z-007', new Error('DB down')),
    );
    const r = await tools.create_ecriture.handler({
      date_ecriture: '2026-05-18',
      description: 'Achat',
      amount_cents: 5000,
      type: 'depense',
    });
    const parsed = parseToolResult(r) as { hint: string; cw_numero_piece: string };
    expect(parsed.cw_numero_piece).toBe('CW-Z-007');
    expect(parsed.hint).toMatch(/ne PAS retry|doublon/);
  });

  // ─── update_ecriture ───────────────────────────────────────────────────

  it("update_ecriture expose les champs d'imputation (éditables sur un brouillon)", () => {
    const schema = tools.update_ecriture.schema as Record<string, unknown>;
    const keys = Object.keys(schema);
    // Champs Baloo-only toujours présents.
    expect(keys).toContain('notes');
    expect(keys).toContain('justif_attendu');
    // Champs d'imputation désormais exposés : modifiables tant que l'écriture
    // est un brouillon, ignorés par le service `updateEcriture` si elle est
    // déjà dans CW (mirror/divergent). C'est ce qui permet de catégoriser un
    // draft sans le recréer dans Comptaweb.
    for (const k of ['category_id', 'unite_id', 'activite_id', 'mode_paiement_id', 'carte_id']) {
      expect(keys).toContain(k);
    }
  });

  it('update_ecriture met à jour les notes', async () => {
    updateEcritureMock.mockResolvedValue({
      id: 'DEP-2026-001',
      status: 'mirror',
      notes: 'Notes du trésorier',
      justif_attendu: 1,
    });
    const r = await tools.update_ecriture.handler({
      id: 'DEP-2026-001',
      notes: 'Notes du trésorier',
    });
    const parsed = parseToolResult(r) as { ok: boolean; ecriture: { notes: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.ecriture.notes).toBe('Notes du trésorier');
  });

  it("update_ecriture transmet la catégorisation d'un brouillon au service (sans push CW)", async () => {
    updateEcritureMock.mockResolvedValue({
      id: 'DEP-2026-009',
      status: 'draft',
      category_id: 'cat-x',
      unite_id: 'unite-y',
      activite_id: 'act-z',
      notes: null,
      justif_attendu: 1,
    });
    const r = await tools.update_ecriture.handler({
      id: 'DEP-2026-009',
      category_id: 'cat-x',
      unite_id: 'unite-y',
      activite_id: 'act-z',
    });
    const parsed = parseToolResult(r) as { ok: boolean; ecriture: { category_id: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.ecriture.category_id).toBe('cat-x');
    // Le handler doit transmettre l'imputation telle quelle au service ;
    // updateEcriture ne pousse RIEN dans CW (simple UPDATE local sur le draft).
    expect(updateEcritureMock).toHaveBeenCalledWith(
      expect.anything(),
      'DEP-2026-009',
      expect.objectContaining({ category_id: 'cat-x', unite_id: 'unite-y', activite_id: 'act-z' }),
    );
  });

  it('update_ecriture introuvable → message clair', async () => {
    updateEcritureMock.mockResolvedValue(null);
    const r = await tools.update_ecriture.handler({ id: 'DEP-INVALID', notes: 'x' });
    expect(parseToolResult(r) as string).toContain('introuvable');
  });

  it('update_ecriture documente la sémantique brouillon-éditable / mirror-verrouillé', () => {
    const d = tools.update_ecriture.description;
    expect(d).toMatch(/brouillon/i);
    expect(d).toMatch(/Comptaweb/);
  });
});
