import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerDepotsEspecesTools } from '../depots-especes';

const FAKE_DEPOT = {
  id: 'DES-001',
  group_id: 'g-test',
  date_depot: '2026-05-18',
  total_amount_cents: 25000,
  ecriture_id: null,
  detail_billets: null,
  notes: null,
  airtable_id: null,
  created_at: '2026-05-18',
};

vi.mock('@/lib/services/depots-especes', () => ({
  listDepotsEspeces: vi.fn(async () => [FAKE_DEPOT]),
  attachDepotEspecesToEcriture: vi.fn(async () => ({ ...FAKE_DEPOT, ecriture_id: 'REC-001' })),
}));

vi.mock('@/lib/services/caisse', () => ({
  createDepotEspecesAvecMouvement: vi.fn(async () => ({
    depot: FAKE_DEPOT,
    mouvement: {
      id: 'CAI-002',
      amount_cents: -25000,
      date_mouvement: '2026-05-18',
      description: 'Dépôt en banque 2026-05-18',
    },
  })),
}));

describe('depots-especes tools (Vague 3)', () => {
  const tools = captureTools(registerDepotsEspecesTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 3 tools', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_depot_especes',
      'list_depots_especes',
      'rapprocher_depot_especes',
    ]);
  });

  it('list_depots_especes formate le total et expose rapproche', async () => {
    const r = await tools.list_depots_especes.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string; total: string; rapproche: boolean }>;
    expect(parsed[0].id).toBe('DES-001');
    expect(parsed[0].total).toMatch(/250,00/);
    expect(parsed[0].rapproche).toBe(false);
  });

  it('create_depot_especes parse le montant et renvoie depot + mouvement', async () => {
    const r = await tools.create_depot_especes.handler({
      date_depot: '2026-05-18',
      montant: '250,00',
    });
    const parsed = parseToolResult(r) as {
      depot: { id: string; total: string };
      mouvement: { montant: string };
    };
    expect(parsed.depot.id).toBe('DES-001');
    expect(parsed.depot.total).toMatch(/250,00/);
    expect(parsed.mouvement.montant).toMatch(/-250,00/);
  });

  it('rapprocher_depot_especes lie au bon ecriture_id', async () => {
    const r = await tools.rapprocher_depot_especes.handler({
      depot_id: 'DES-001',
      ecriture_id: 'REC-001',
    });
    const parsed = parseToolResult(r) as { id: string; ecriture_id: string };
    expect(parsed.ecriture_id).toBe('REC-001');
  });
});
