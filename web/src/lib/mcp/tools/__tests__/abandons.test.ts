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

describe('abandons tools (Vague 3)', () => {
  const tools = captureTools(registerAbandonTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 3 tools', () => {
    expect(Object.keys(tools).sort()).toEqual(['create_abandon', 'list_abandons', 'update_abandon']);
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

  it('update_abandon confirme la mise à jour', async () => {
    const r = await tools.update_abandon.handler({ id: 'ABF-2026-001', status: 'valide' });
    const parsed = parseToolResult(r) as { id: string };
    expect(parsed.id).toBe('ABF-2026-001');
  });
});
