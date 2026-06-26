import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerEcrituresTools } from '../ecritures';

const listEcrituresMock = vi.fn();
const updateEcritureMock = vi.fn();

vi.mock('@/lib/services/ecritures', () => ({
  listEcritures: (...args: unknown[]) => listEcrituresMock(...args),
  updateEcriture: (...args: unknown[]) => updateEcritureMock(...args),
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

  it('expose list_ecritures + update_ecriture (sans create_ecriture)', () => {
    expect(Object.keys(tools).sort()).toEqual(['list_ecritures', 'update_ecriture']);
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
