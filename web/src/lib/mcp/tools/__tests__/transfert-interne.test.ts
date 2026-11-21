// Critère 7 (#51) : le MCP expose la même action — un assistant liste un
// brouillon, le qualifie en transfert interne avec un mode, puis le lie au
// mouvement de caisse.
//
// Contrat : `update_ecriture` accepte `type: 'transfert_interne'` et
// `mode_transfert` ; `rapprocher_depot_especes` lie un dépôt au brouillon.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { captureTools, parseToolResult } from './test-helpers';
import { registerEcrituresTools } from '../ecritures';
import { registerDepotsEspecesTools } from '../depots-especes';

const updateEcriture = vi.fn(async (_ctx: unknown, id: string, patch: Record<string, unknown>) => ({
  id,
  status: 'draft',
  category_id: null,
  unite_id: null,
  activite_id: null,
  mode_paiement_id: null,
  carte_id: null,
  notes: null,
  justif_attendu: 1,
  ...patch,
}));

vi.mock('@/lib/services/ecritures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/ecritures')>();
  return { ...actual, updateEcriture: (...a: Parameters<typeof updateEcriture>) => updateEcriture(...a) };
});

const attachDepot = vi.fn(async (_ctx: unknown, depotId: string, ecritureId: string) => ({
  id: depotId,
  ecriture_id: ecritureId,
  total_amount_cents: 25000,
  date_depot: '2026-10-03',
  created_at: '2026-10-03',
}));
vi.mock('@/lib/services/depots-especes', () => ({
  listDepotsEspeces: vi.fn(async () => []),
  attachDepotEspecesToEcriture: (...a: Parameters<typeof attachDepot>) => attachDepot(...a),
}));
vi.mock('@/lib/services/caisse', () => ({ createDepotEspecesAvecMouvement: vi.fn() }));

describe('MCP — transfert interne', () => {
  const ecritures = captureTools(registerEcrituresTools);
  const depots = captureTools(registerDepotsEspecesTools);
  beforeEach(() => vi.clearAllMocks());

  it.each(['depot_especes', 'retrait_especes', 'transfert_especes'])(
    'update_ecriture qualifie un brouillon en transfert interne (mode %s)',
    async (mode) => {
      const schema = z.object(ecritures.update_ecriture.schema as z.ZodRawShape);
      const parsed = schema.safeParse({ id: 'E1', type: 'transfert_interne', mode_transfert: mode });
      expect(parsed.success).toBe(true);

      await ecritures.update_ecriture.handler(parsed.success ? parsed.data : {});
      expect(updateEcriture).toHaveBeenCalledWith(
        expect.anything(),
        'E1',
        expect.objectContaining({ type: 'transfert_interne', mode_transfert: mode }),
      );
    },
  );

  it('un assistant lie ensuite le brouillon au mouvement de caisse (dépôt)', async () => {
    const schema = z.object(ecritures.update_ecriture.schema as z.ZodRawShape);
    expect(
      schema.safeParse({ id: 'E1', type: 'transfert_interne', mode_transfert: 'depot_especes' }).success,
    ).toBe(true);
    const r = await depots.rapprocher_depot_especes.handler({
      depot_id: 'DES-001',
      ecriture_id: 'E1',
    });
    expect((parseToolResult(r) as { ecriture_id: string }).ecriture_id).toBe('E1');
  });
});
