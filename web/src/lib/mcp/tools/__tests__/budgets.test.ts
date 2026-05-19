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
}));

describe('budgets tools (Vague 2)', () => {
  const tools = captureTools(registerBudgetTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 4 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_budget',
      'create_budget_ligne',
      'list_budget_lignes',
      'list_budgets',
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
});
