import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerBudgetTools } from '../budgets';

const FAKE_BUDGET = {
  id: 'bdg-g-2025-2026',
  group_id: 'g-test',
  saison: '2025-2026',
  statut: 'projet',
  vote_le: null,
  notes: null,
  created_at: '2025-09-01',
  updated_at: '2025-09-01',
};

const FAKE_LIGNE = {
  id: 'bdl-abcd',
  budget_id: 'bdg-g-2025-2026',
  unite_id: null,
  category_id: null,
  activite_id: null,
  libelle: 'Camp été',
  type: 'depense',
  amount_cents: 1900000,
  notes: null,
};

const updateBudgetLigneMock = vi.fn();
const deleteBudgetLigneMock = vi.fn();
const updateBudgetStatutMock = vi.fn();

vi.mock('@/lib/services/budgets', () => ({
  listBudgets: vi.fn(async () => [FAKE_BUDGET]),
  createBudget: vi.fn(async () => FAKE_BUDGET),
  createBudgetLigne: vi.fn(async () => FAKE_LIGNE),
  listBudgetLignes: vi.fn(async () => ({
    lignes: [FAKE_LIGNE],
    total_depenses_cents: 1900000,
    total_recettes_cents: 0,
    solde_cents: -1900000,
  })),
  updateBudgetLigne: (...args: unknown[]) => updateBudgetLigneMock(...args),
  deleteBudgetLigne: (...args: unknown[]) => deleteBudgetLigneMock(...args),
  updateBudgetStatut: (...args: unknown[]) => updateBudgetStatutMock(...args),
}));

describe('budgets tools (Vague 2 + Lot 3)', () => {
  const tools = captureTools(registerBudgetTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 7 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_budget',
      'create_budget_ligne',
      'delete_budget_ligne',
      'list_budget_lignes',
      'list_budgets',
      'update_budget_ligne',
      'update_budget_statut',
    ]);
  });

  it('list_budgets retourne un JSON parsable', async () => {
    const r = await tools.list_budgets.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('bdg-g-2025-2026');
  });

  it('create_budget confirme', async () => {
    const r = await tools.create_budget.handler({ saison: '2025-2026' });
    expect(parseToolResult(r) as string).toContain('bdg-g-2025-2026');
  });

  it('create_budget_ligne parse le montant et confirme', async () => {
    const r = await tools.create_budget_ligne.handler({
      budget_id: 'bdg-g-2025-2026',
      libelle: 'Camp été',
      type: 'depense',
      amount: '19 000',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('bdl-abcd');
    expect(txt).toContain('19000,00');
  });

  it('list_budget_lignes retourne lignes + totaux formatés', async () => {
    const r = await tools.list_budget_lignes.handler({ budget_id: 'bdg-g-2025-2026' });
    const parsed = parseToolResult(r) as {
      lignes: Array<{ id: string; montant: string }>;
      total_depenses: string;
      solde: string;
    };
    expect(parsed.lignes[0].montant).toMatch(/19000,00/);
    expect(parsed.total_depenses).toMatch(/19000,00/);
    expect(parsed.solde).toMatch(/-19000,00/);
  });

  // ─── Lot 3 : update_budget_ligne ─────────────────────────────────────

  it('update_budget_ligne convertit amount et transmet le patch au service', async () => {
    updateBudgetLigneMock.mockResolvedValue({ ...FAKE_LIGNE, libelle: 'Camp été modifié', amount_cents: 2000000 });
    const r = await tools.update_budget_ligne.handler({
      id: 'bdl-abcd',
      libelle: 'Camp été modifié',
      amount: '20 000',
    });
    expect(updateBudgetLigneMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'g-test' }),
      'bdl-abcd',
      expect.objectContaining({ libelle: 'Camp été modifié', amount_cents: 2000000 }),
    );
    const parsed = parseToolResult(r) as { libelle: string; montant: string };
    expect(parsed.libelle).toBe('Camp été modifié');
    expect(parsed.montant).toMatch(/20000,00/);
  });

  it('update_budget_ligne introuvable → message clair', async () => {
    updateBudgetLigneMock.mockResolvedValue(null);
    const r = await tools.update_budget_ligne.handler({ id: 'bdl-inexistant' });
    expect(parseToolResult(r) as string).toContain('introuvable');
  });

  // ─── Lot 3 : delete_budget_ligne ────────────────────────────────────

  it('delete_budget_ligne confirme la suppression', async () => {
    deleteBudgetLigneMock.mockResolvedValue(true);
    const r = await tools.delete_budget_ligne.handler({ id: 'bdl-abcd' });
    expect(deleteBudgetLigneMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'g-test' }),
      'bdl-abcd',
    );
    expect(parseToolResult(r) as string).toContain('supprimée');
  });

  it('delete_budget_ligne introuvable → message clair', async () => {
    deleteBudgetLigneMock.mockResolvedValue(false);
    const r = await tools.delete_budget_ligne.handler({ id: 'bdl-inexistant' });
    expect(parseToolResult(r) as string).toContain('introuvable');
  });

  // ─── Lot 3 : update_budget_statut ───────────────────────────────────

  it('update_budget_statut transmet le nouveau statut au service', async () => {
    updateBudgetStatutMock.mockResolvedValue({ ...FAKE_BUDGET, statut: 'vote', vote_le: '2026-06-26' });
    const r = await tools.update_budget_statut.handler({
      budget_id: 'bdg-g-2025-2026',
      statut: 'vote',
    });
    expect(updateBudgetStatutMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'g-test' }),
      'bdg-g-2025-2026',
      'vote',
    );
    const parsed = parseToolResult(r) as { statut: string; vote_le: string };
    expect(parsed.statut).toBe('vote');
    expect(parsed.vote_le).toBe('2026-06-26');
  });

  it('update_budget_statut introuvable → message clair', async () => {
    updateBudgetStatutMock.mockResolvedValue(null);
    const r = await tools.update_budget_statut.handler({
      budget_id: 'bdg-inexistant',
      statut: 'cloture',
    });
    expect(parseToolResult(r) as string).toContain('introuvable');
  });
});
