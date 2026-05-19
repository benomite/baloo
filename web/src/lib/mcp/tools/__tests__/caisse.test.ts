import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCaisseTools } from '../caisse';

vi.mock('@/lib/services/caisse', () => ({
  listMouvementsCaisse: vi.fn(async () => ({
    mouvements: [
      {
        id: 'CAI-2026-001',
        amount_cents: 1500,
        solde_apres_cents: 5000,
        date_mouvement: '2026-05-18',
        description: 'Vente gâteaux',
      },
    ],
    solde: 5000,
  })),
  createMouvementCaisse: vi.fn(async () => ({
    id: 'CAI-2026-002',
    amount_cents: -800,
    solde_apres_cents: 4200,
    date_mouvement: '2026-05-19',
    description: 'Achat fournitures',
  })),
}));

vi.mock('@/lib/services/caisse-sync', () => ({
  syncCaisseFromComptaweb: vi.fn(async () => ({
    caisseId: 1,
    libelle: 'Caisse principale',
    soldeComptaweb: 5000,
    soldeBaloo: 5000,
    stats: { pulled: 2, inserted: 0, matched_by_cw_id: 2, matched_by_fallback: 0, unchanged: 0 },
  })),
  discoverCaisses: vi.fn(async () => [
    { id: 1, libelle: 'Caisse principale', gerant: 'X', devise: 'EUR', inactif: false },
  ]),
  resolveCaisseId: vi.fn(async () => 1),
}));

describe('caisse tools (Vague 3)', () => {
  const tools = captureTools(registerCaisseTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 4 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_mouvement_caisse',
      'cw_list_caisses',
      'cw_sync_caisse',
      'list_mouvements_caisse',
    ]);
  });

  it('list_mouvements_caisse formate les montants', async () => {
    const r = await tools.list_mouvements_caisse.handler({});
    const parsed = parseToolResult(r) as { solde_caisse: string; mouvements: Array<{ montant: string }> };
    expect(parsed.solde_caisse).toMatch(/50,00/);
    expect(parsed.mouvements[0].montant).toMatch(/15,00/);
  });

  it('cw_list_caisses renvoie un objet caisses', async () => {
    const r = await tools.cw_list_caisses.handler({});
    const parsed = parseToolResult(r) as { caisses: unknown[] };
    expect(parsed.caisses).toHaveLength(1);
  });

  it('cw_sync_caisse renvoie les stats + soldes formatés', async () => {
    const r = await tools.cw_sync_caisse.handler({ caisse_id: 1 });
    const parsed = parseToolResult(r) as { stats: { pulled: number }; solde_baloo: string };
    expect(parsed.stats.pulled).toBe(2);
    expect(parsed.solde_baloo).toMatch(/50,00/);
  });

  it('create_mouvement_caisse parse le montant signé', async () => {
    const r = await tools.create_mouvement_caisse.handler({
      date_mouvement: '2026-05-19',
      description: 'Achat fournitures',
      montant: '-8,00',
    });
    const parsed = parseToolResult(r) as { montant: string };
    expect(parsed.montant).toMatch(/-8,00/);
  });

  it("create_mouvement_caisse documente l'aspect Baloo-only", () => {
    expect(tools.create_mouvement_caisse.description).toContain('Baloo-only');
  });
});
