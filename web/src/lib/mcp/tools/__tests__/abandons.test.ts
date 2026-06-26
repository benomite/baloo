import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerAbandonTools } from '../abandons';

const FAKE = {
  id: 'ABF-2026-001',
  group_id: 'g-test',
  donateur: 'Jean Dupont',
  amount_cents: 4250,
  date_depense: '2026-05-10',
  nature: 'Carburant',
  unite_id: null,
  annee_fiscale: '2025',
  status: 'a_traiter',
  notes: null,
  created_at: '2026-05-18',
  updated_at: '2026-05-18',
};

vi.mock('@/lib/services/abandons', () => ({
  listAbandons: vi.fn(async () => [FAKE]),
  createAbandon: vi.fn(async () => FAKE),
  updateAbandon: vi.fn(async () => FAKE),
}));

vi.mock('@/lib/services/abandon-transition', () => ({
  applyAbandonTransition: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/ids', () => ({
  currentTimestamp: vi.fn(() => '2026-06-26T00:00:00.000Z'),
}));

describe('abandons tools (Vague 3 + parité MCP)', () => {
  const tools = captureTools(registerAbandonTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 4 tools (list, create, update, transition)', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_abandon',
      'list_abandons',
      'transition_abandon',
      'update_abandon',
    ]);
  });

  it('update_abandon ne possède plus de champ status dans son schema', () => {
    const schema = tools.update_abandon.schema as Record<string, unknown>;
    expect(schema).not.toHaveProperty('status');
  });

  it('list_abandons formate le montant', async () => {
    const r = await tools.list_abandons.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string; montant: string }>;
    expect(parsed[0].id).toBe('ABF-2026-001');
    expect(parsed[0].montant).toMatch(/42,50/);
  });

  it('create_abandon parse montant', async () => {
    const r = await tools.create_abandon.handler({
      donateur: 'Jean Dupont',
      montant: '42,50',
      date_depense: '2026-05-10',
      nature: 'Carburant',
      annee_fiscale: '2025',
    });
    const parsed = parseToolResult(r) as { id: string; montant: string };
    expect(parsed.id).toBe('ABF-2026-001');
    expect(parsed.montant).toMatch(/42,50/);
  });

  it('update_abandon met à jour sans status', async () => {
    const r = await tools.update_abandon.handler({ id: 'ABF-2026-001', notes: 'ok' });
    const parsed = parseToolResult(r) as { id: string };
    expect(parsed.id).toBe('ABF-2026-001');
  });

  it('transition_abandon retourne { ok: true } via le service', async () => {
    const r = await tools.transition_abandon.handler({
      id: 'ABF-2026-001',
      target_status: 'valide',
    });
    const parsed = parseToolResult(r) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('transition_abandon propage { ok: false } du service', async () => {
    const { applyAbandonTransition } = await import('@/lib/services/abandon-transition');
    vi.mocked(applyAbandonTransition).mockResolvedValueOnce({
      ok: false,
      reason: 'wrong_role',
      message: 'Action réservée aux trésoriers / RG.',
    });
    const r = await tools.transition_abandon.handler({
      id: 'ABF-2026-001',
      target_status: 'valide',
    });
    const parsed = parseToolResult(r) as { ok: boolean; reason: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('wrong_role');
  });
});
