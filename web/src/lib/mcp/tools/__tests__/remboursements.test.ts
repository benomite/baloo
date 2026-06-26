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

vi.mock('@/lib/services/remboursement-transition', () => ({
  applyRemboursementTransition: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(async () => ({ email: 'tresorier@test.com', nom_affichage: 'Trésorier' })),
    })),
  })),
}));

vi.mock('@/lib/types', async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    REMBOURSEMENT_STATUSES: ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue', 'termine', 'refuse'] as const,
  };
});

describe('remboursements tools (Vague 3 + parité MCP)', () => {
  const tools = captureTools(registerRemboursementTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 4 tools (list, create, update, transition)', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_remboursement',
      'list_remboursements',
      'transition_remboursement',
      'update_remboursement',
    ]);
  });

  it('update_remboursement ne possède plus de champ status dans son schema', () => {
    const schema = tools.update_remboursement.schema as Record<string, unknown>;
    expect(schema).not.toHaveProperty('status');
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

  it('update_remboursement met à jour sans status', async () => {
    const r = await tools.update_remboursement.handler({ id: 'RBT-2026-001', notes: 'ok' });
    const parsed = parseToolResult(r) as { id: string };
    expect(parsed.id).toBe('RBT-2026-001');
  });

  it('transition_remboursement retourne { ok: true } via le service', async () => {
    const r = await tools.transition_remboursement.handler({
      id: 'RBT-2026-001',
      target_status: 'valide_tresorier',
    });
    const parsed = parseToolResult(r) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('transition_remboursement propage { ok: false } du service', async () => {
    const { applyRemboursementTransition } = await import('@/lib/services/remboursement-transition');
    vi.mocked(applyRemboursementTransition).mockResolvedValueOnce({
      ok: false,
      reason: 'wrong_role',
      message: 'Action réservée aux rôles : tresorier / RG.',
    });
    const r = await tools.transition_remboursement.handler({
      id: 'RBT-2026-001',
      target_status: 'valide_tresorier',
    });
    const parsed = parseToolResult(r) as { ok: boolean; reason: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('wrong_role');
  });
});
