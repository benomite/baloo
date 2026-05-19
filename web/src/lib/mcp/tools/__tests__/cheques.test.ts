import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerChequesTools } from '../cheques';

const FAKE = {
  id: 'DCH-2026-001',
  group_id: 'g-test',
  date_depot: '2026-05-18',
  type_depot: 'banque',
  total_amount_cents: 12500,
  nombre_cheques: 2,
  detail_cheques: JSON.stringify([
    { emetteur: 'Famille A', montant_cents: 5000, numero: null },
    { emetteur: 'Famille B', montant_cents: 7500, numero: '123' },
  ]),
  confirmation_status: 'en_attente',
  notes: null,
  created_at: '2026-05-18',
};

vi.mock('@/lib/services/cheques', () => ({
  listDepotsCheques: vi.fn(async () => [FAKE]),
  createDepotCheques: vi.fn(async () => FAKE),
}));

describe('cheques tools (Vague 3)', () => {
  const tools = captureTools(registerChequesTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose list/create_depot_cheques', () => {
    expect(Object.keys(tools).sort()).toEqual(['create_depot_cheques', 'list_depots_cheques']);
  });

  it('list_depots_cheques parse detail_cheques JSON', async () => {
    const r = await tools.list_depots_cheques.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string; total: string; detail_cheques: unknown[] }>;
    expect(parsed[0].id).toBe('DCH-2026-001');
    expect(parsed[0].total).toMatch(/125,00/);
    expect(parsed[0].detail_cheques).toHaveLength(2);
  });

  it('create_depot_cheques convertit montant', async () => {
    const r = await tools.create_depot_cheques.handler({
      date_depot: '2026-05-18',
      type_depot: 'banque',
      cheques: [{ emetteur: 'Famille A', montant: '50,00' }],
    });
    const parsed = parseToolResult(r) as { id: string; total: string };
    expect(parsed.id).toBe('DCH-2026-001');
    expect(parsed.total).toMatch(/125,00/);
  });
});
