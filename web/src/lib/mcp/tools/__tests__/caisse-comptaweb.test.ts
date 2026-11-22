// #61 : surface MCP des tools caisse ↔ Comptaweb (formatage, preview par
// défaut, erreurs rendues en isError).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCaisseComptawebTools } from '../caisse-comptaweb';
import {
  pushMouvementCaisseToComptaweb,
  rapprocherMouvementCaisseComptaweb,
  updateMouvementCaisseAvantComptaweb,
} from '@/lib/services/caisse-comptaweb';

const MVT = { id: 'CAI-1', amount_cents: -800, description: 'Achat', date_mouvement: '2026-10-05' };

vi.mock('@/lib/services/caisse-comptaweb', () => ({
  listMouvementsCaisseBalooOnly: vi.fn(async () => [
    { ...MVT },
    { ...MVT, id: 'CAI-2', amount_cents: 1500 },
  ]),
  pushMouvementCaisseToComptaweb: vi.fn(async () => ({ ok: true, dryRun: true, message: 'Preview OK' })),
  rapprocherMouvementCaisseComptaweb: vi.fn(async () => ({
    mouvement: { ...MVT, comptaweb_ecriture_id: 4242 },
    rapproche_de: null,
    avertissements: [],
  })),
  updateMouvementCaisseAvantComptaweb: vi.fn(async () => ({ ...MVT, category_id: 'cat-1' })),
}));

describe('tools caisse ↔ Comptaweb (#61)', () => {
  const tools = captureTools(registerCaisseComptawebTools, { scopeUniteIds: ['u-1'] });
  beforeEach(() => vi.clearAllMocks());

  it('liste les Baloo-only avec total et montants formatés', async () => {
    const r = parseToolResult(await tools.list_mouvements_caisse_baloo_only.handler({})) as {
      total: number;
      montant_total: string;
      mouvements: Array<{ montant: string }>;
    };
    expect(r.total).toBe(2);
    expect(r.montant_total).toMatch(/7,00/);
    expect(r.mouvements[0].montant).toMatch(/-8,00/);
  });

  it('push : transmet dry_run et rend isError quand le service refuse', async () => {
    await tools.push_mouvement_caisse_comptaweb.handler({ mouvement_id: 'CAI-1', dry_run: false });
    expect(vi.mocked(pushMouvementCaisseToComptaweb).mock.calls[0][1]).toBe('CAI-1');
    expect(vi.mocked(pushMouvementCaisseToComptaweb).mock.calls[0][2]).toEqual({ dryRun: false });

    const ok = (await tools.push_mouvement_caisse_comptaweb.handler({ mouvement_id: 'CAI-1', dry_run: true })) as {
      isError?: boolean;
    };
    expect(ok.isError).toBeUndefined();

    vi.mocked(pushMouvementCaisseToComptaweb).mockResolvedValueOnce({ ok: false, dryRun: false, message: 'non' });
    const refus = (await tools.push_mouvement_caisse_comptaweb.handler({ mouvement_id: 'CAI-1', dry_run: false })) as {
      isError?: boolean;
    };
    expect(refus.isError).toBe(true);

    vi.mocked(pushMouvementCaisseToComptaweb).mockRejectedValueOnce(new Error('session morte'));
    const ko = await tools.push_mouvement_caisse_comptaweb.handler({ mouvement_id: 'CAI-1', dry_run: false });
    expect((ko as { isError?: boolean }).isError).toBe(true);
    expect(parseToolResult(ko)).toEqual({ ok: false, message: 'session morte' });
  });

  it('push : preview par défaut dans le schéma', () => {
    const schema = tools.push_mouvement_caisse_comptaweb.schema as { dry_run: { parse: (v: unknown) => unknown } };
    expect(schema.dry_run.parse(undefined)).toBe(true);
  });

  it('rapprocher : transmet le choix de l’utilisateur, erreurs en isError', async () => {
    const r = parseToolResult(
      await tools.rapprocher_mouvement_caisse_comptaweb.handler({ mouvement_id: 'CAI-1', comptaweb_ecriture_id: 4242 }),
    ) as { mouvement: { montant: string } };
    expect(vi.mocked(rapprocherMouvementCaisseComptaweb).mock.calls[0].slice(1)).toEqual(['CAI-1', 4242]);
    expect(r.mouvement.montant).toMatch(/-8,00/);

    vi.mocked(rapprocherMouvementCaisseComptaweb).mockRejectedValueOnce(new Error('déjà lié'));
    const ko = await tools.rapprocher_mouvement_caisse_comptaweb.handler({
      mouvement_id: 'CAI-1',
      comptaweb_ecriture_id: 4242,
    });
    expect((ko as { isError?: boolean }).isError).toBe(true);
    expect(parseToolResult(ko)).toEqual({ error: 'déjà lié' });
  });

  it('update : parse le montant, laisse absents les champs non fournis', async () => {
    await tools.update_mouvement_caisse.handler({ mouvement_id: 'CAI-1', montant: '-9,50', category_id: 'cat-1' });
    const patch = vi.mocked(updateMouvementCaisseAvantComptaweb).mock.calls[0][2];
    expect(patch.amount_cents).toBe(-950);
    expect(patch.category_id).toBe('cat-1');
    expect(patch.description).toBeUndefined();

    await tools.update_mouvement_caisse.handler({ mouvement_id: 'CAI-1', notes: 'x' });
    expect(vi.mocked(updateMouvementCaisseAvantComptaweb).mock.calls[1][2].amount_cents).toBeUndefined();

    vi.mocked(updateMouvementCaisseAvantComptaweb).mockRejectedValueOnce(new Error('miroir'));
    const ko = await tools.update_mouvement_caisse.handler({ mouvement_id: 'CAI-1', notes: 'x' });
    expect((ko as { isError?: boolean }).isError).toBe(true);
  });

  it('passe le périmètre d’unités du contexte MCP au service', async () => {
    await tools.update_mouvement_caisse.handler({ mouvement_id: 'CAI-1', notes: 'x' });
    expect(vi.mocked(updateMouvementCaisseAvantComptaweb).mock.calls[0][0]).toEqual({
      groupId: 'g-test',
      scopeUniteIds: ['u-1'],
    });
  });
});
