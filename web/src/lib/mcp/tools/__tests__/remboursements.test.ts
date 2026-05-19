import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerRemboursementTools } from '../remboursements';

const FAKE = {
  id: 'RBT-2026-001',
  group_id: 'g-test',
  demandeur: 'Marie Martin',
  amount_cents: 3200,
  date_depense: '2026-05-10',
  nature: 'Transport',
  unite_id: null,
  justificatif_status: 'en_attente',
  mode_paiement_id: null,
  status: 'a_traiter',
  notes: null,
  created_at: '2026-05-18',
  updated_at: '2026-05-18',
};

vi.mock('@/lib/services/remboursements', () => ({
  listRemboursements: vi.fn(async () => [FAKE]),
  createRemboursement: vi.fn(async () => FAKE),
  updateRemboursement: vi.fn(async () => FAKE),
}));

vi.mock('@/lib/types', async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    REMBOURSEMENT_STATUSES: ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue', 'termine', 'refuse'] as const,
  };
});

describe('remboursements tools (Vague 3)', () => {
  const tools = captureTools(registerRemboursementTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 3 tools', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_remboursement',
      'list_remboursements',
      'update_remboursement',
    ]);
  });

  it('list_remboursements formate le montant', async () => {
    const r = await tools.list_remboursements.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string; montant: string }>;
    expect(parsed[0].id).toBe('RBT-2026-001');
    expect(parsed[0].montant).toMatch(/32,00/);
  });

  it('create_remboursement parse le montant', async () => {
    const r = await tools.create_remboursement.handler({
      demandeur: 'Marie Martin',
      montant: '32,00',
      date_depense: '2026-05-10',
      nature: 'Transport',
    });
    const parsed = parseToolResult(r) as { id: string; montant: string };
    expect(parsed.id).toBe('RBT-2026-001');
    expect(parsed.montant).toMatch(/32,00/);
  });

  it('update_remboursement confirme', async () => {
    const r = await tools.update_remboursement.handler({ id: 'RBT-2026-001', status: 'valide_rg' });
    const parsed = parseToolResult(r) as { id: string };
    expect(parsed.id).toBe('RBT-2026-001');
  });
});
