// #61 : create_mouvement_caisse prend une unité ; un chef d'unité ne crée de
// brouillon que pour les siennes (même règle que les écritures).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCaisseTools } from '../caisse';
import { createMouvementCaisse } from '@/lib/services/caisse';

vi.mock('@/lib/services/caisse', () => ({
  listMouvementsCaisse: vi.fn(),
  updateMouvementCaisse: vi.fn(),
  attachJustificatifMouvementCaisse: vi.fn(),
  createMouvementCaisse: vi.fn(async () => ({
    id: 'CAI-2026-002',
    amount_cents: -800,
    solde_apres_cents: null,
    date_mouvement: '2026-05-19',
    description: 'Achat fournitures',
  })),
}));

vi.mock('@/lib/services/caisse-sync', () => ({
  syncCaisseFromComptaweb: vi.fn(),
  discoverCaisses: vi.fn(),
  resolveCaisseId: vi.fn(),
}));

const BASE = { date_mouvement: '2026-05-19', description: 'Achat fournitures', montant: '-8,00' };

describe("create_mouvement_caisse — périmètre d'unités (#61)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuse l'unité d'un autre chef : erreur, rien créé", async () => {
    const tools = captureTools(registerCaisseTools, { scopeUniteIds: ['u-1', 'u-2'] });
    const r = await tools.create_mouvement_caisse.handler({ ...BASE, unite_id: 'u-9' });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify(parseToolResult(r))).toContain('Choisis une unité parmi les tiennes.');
    expect(createMouvementCaisse).not.toHaveBeenCalled();
  });

  it('accepte une de ses unités', async () => {
    const tools = captureTools(registerCaisseTools, { scopeUniteIds: ['u-1', 'u-2'] });
    await tools.create_mouvement_caisse.handler({ ...BASE, unite_id: 'u-2' });
    expect(vi.mocked(createMouvementCaisse).mock.calls[0][1]).toMatchObject({ unite_id: 'u-2', status: 'draft' });
  });

  it('chef à une seule unité : son unité est imposée', async () => {
    const tools = captureTools(registerCaisseTools, { scopeUniteIds: ['u-1'] });
    await tools.create_mouvement_caisse.handler({ ...BASE, unite_id: 'u-9' });
    expect(vi.mocked(createMouvementCaisse).mock.calls[0][1]).toMatchObject({ unite_id: 'u-1' });
  });

  it('trésorier (aucun périmètre) : unité libre', async () => {
    const tools = captureTools(registerCaisseTools);
    await tools.create_mouvement_caisse.handler({ ...BASE, unite_id: 'u-9' });
    expect(vi.mocked(createMouvementCaisse).mock.calls[0][1]).toMatchObject({ unite_id: 'u-9' });
  });
});
