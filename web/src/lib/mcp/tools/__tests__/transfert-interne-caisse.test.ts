// Transfert interne (#51) côté MCP : un assistant qualifie un brouillon
// (update_ecriture renvoie type + mode), crée le dépôt ou le retrait depuis le
// brouillon (`ecriture_id`), ou lie un retrait existant.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { captureTools, parseToolResult } from './test-helpers';

const svc = vi.hoisted(() => ({
  updateEcriture: vi.fn(),
  createDepot: vi.fn(),
  createRetrait: vi.fn(),
  attachRetrait: vi.fn(),
  listRetraits: vi.fn(),
}));

vi.mock('@/lib/services/ecritures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/ecritures')>();
  return { ...actual, updateEcriture: svc.updateEcriture };
});
vi.mock('@/lib/services/depots-especes', () => ({
  listDepotsEspeces: vi.fn(async () => []),
  attachDepotEspecesToEcriture: vi.fn(),
}));
vi.mock('@/lib/services/caisse', () => ({
  createDepotEspecesAvecMouvement: svc.createDepot,
  createRetraitEspecesAvecMouvement: svc.createRetrait,
  attachRetraitEspecesToEcriture: svc.attachRetrait,
  listRetraitsEspecesEnAttente: svc.listRetraits,
}));

import { registerEcrituresTools } from '../ecritures';
import { registerDepotsEspecesTools } from '../depots-especes';
import { registerRetraitsEspecesTools } from '../retraits-especes';

const RETRAIT = {
  id: 'CAI-9', amount_cents: 8000, date_mouvement: '2026-10-05', type: 'retrait',
  status: 'rapproche', numero_piece: 'E2',
};

describe('MCP — transfert interne et caisse', () => {
  const ecritures = captureTools(registerEcrituresTools);
  const depots = captureTools(registerDepotsEspecesTools);
  const retraits = captureTools(registerRetraitsEspecesTools);
  beforeEach(() => vi.clearAllMocks());

  it('update_ecriture renvoie le type et le mode enregistrés', async () => {
    svc.updateEcriture.mockResolvedValue({
      id: 'E1', status: 'draft', type: 'transfert_interne', mode_transfert: 'depot_especes',
      category_id: null, unite_id: null, activite_id: null, mode_paiement_id: null, carte_id: null,
      notes: null, justif_attendu: 1,
    });
    const r = await ecritures.update_ecriture.handler({ id: 'E1', type: 'transfert_interne', mode_transfert: 'depot_especes' });
    expect((parseToolResult(r) as { ecriture: unknown }).ecriture).toMatchObject({
      type: 'transfert_interne', mode_transfert: 'depot_especes',
    });
  });

  it('update_ecriture refuse un mode inconnu', () => {
    const schema = z.object(ecritures.update_ecriture.schema as z.ZodRawShape);
    expect(schema.safeParse({ id: 'E1', mode_transfert: 'virement' }).success).toBe(false);
  });

  it('list_ecritures filtre sur les transferts internes', () => {
    const schema = z.object(ecritures.list_ecritures.schema as z.ZodRawShape);
    expect(schema.safeParse({ type: 'transfert_interne' }).success).toBe(true);
  });

  it('create_depot_especes crée le dépôt depuis le brouillon', async () => {
    svc.createDepot.mockResolvedValue({
      depot: { id: 'DES-1', total_amount_cents: 25000, ecriture_id: 'E1' },
      mouvement: { id: 'CAI-1', amount_cents: -25000, status: 'rapproche' },
    });
    const r = await depots.create_depot_especes.handler({ date_depot: '2026-10-03', montant: '250,00', ecriture_id: 'E1' });
    expect(svc.createDepot).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      expect.objectContaining({ total_amount_cents: 25000, ecriture_id: 'E1' }),
    );
    expect((parseToolResult(r) as { depot: { ecriture_id: string } }).depot.ecriture_id).toBe('E1');
  });

  it('create_depot_especes sans brouillon : ecriture_id null', async () => {
    svc.createDepot.mockResolvedValue({ depot: { total_amount_cents: 100 }, mouvement: { amount_cents: -100 } });
    await depots.create_depot_especes.handler({ date_depot: '2026-10-03', montant: '1,00' });
    expect(svc.createDepot.mock.calls[0][1]).toMatchObject({ ecriture_id: null });
  });

  it('expose les trois outils de retrait', () => {
    expect(Object.keys(retraits).sort()).toEqual([
      'create_retrait_especes', 'list_retraits_especes', 'rapprocher_retrait_especes',
    ]);
  });

  it('create_retrait_especes crée le retrait depuis le brouillon', async () => {
    svc.createRetrait.mockResolvedValue({ mouvement: RETRAIT });
    const r = await retraits.create_retrait_especes.handler({ date_retrait: '2026-10-05', montant: '80,00', ecriture_id: 'E2' });
    expect(svc.createRetrait).toHaveBeenCalledWith(
      { groupId: 'g-test' },
      { date_retrait: '2026-10-05', total_amount_cents: 8000, description: null, notes: null, ecriture_id: 'E2' },
    );
    expect(parseToolResult(r)).toMatchObject({ id: 'CAI-9', montant: expect.stringMatching(/80,00/) });
  });

  it('create_retrait_especes valide la date', () => {
    const schema = z.object(retraits.create_retrait_especes.schema as z.ZodRawShape);
    expect(schema.safeParse({ date_retrait: '05/10/2026', montant: '80,00' }).success).toBe(false);
  });

  it('rapprocher_retrait_especes lie le retrait au brouillon', async () => {
    svc.attachRetrait.mockResolvedValue(RETRAIT);
    const r = await retraits.rapprocher_retrait_especes.handler({ mouvement_id: 'CAI-9', ecriture_id: 'E2' });
    expect(svc.attachRetrait).toHaveBeenCalledWith({ groupId: 'g-test' }, 'CAI-9', 'E2');
    expect(parseToolResult(r)).toMatchObject({ status: 'rapproche', numero_piece: 'E2' });
  });

  it('list_retraits_especes liste les retraits en attente', async () => {
    svc.listRetraits.mockResolvedValue([{ ...RETRAIT, status: 'saisi' }]);
    const r = await retraits.list_retraits_especes.handler({ limit: 10 });
    expect(svc.listRetraits).toHaveBeenCalledWith({ groupId: 'g-test' }, { limit: 10 });
    expect((parseToolResult(r) as Array<{ id: string }>)[0].id).toBe('CAI-9');
  });
});
