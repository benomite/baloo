// Tool MCP `fusionner_brouillons` (ticket #49) : surface d'entrée et retour.
// L'effet BDD est testé au niveau service (services/__tests__/ecritures-fusion).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';

const fusionnerBrouillonsMock = vi.fn();
vi.mock('@/lib/services/ecritures-fusion', () => ({
  fusionnerBrouillons: (...args: unknown[]) => fusionnerBrouillonsMock(...args),
}));
vi.mock('@/lib/services/ecritures', () => ({
  listEcritures: vi.fn(),
  updateEcriture: vi.fn(),
  batchUpdateEcritures: vi.fn(),
}));

import { registerEcrituresTools } from '../ecritures';

describe('fusionner_brouillons', () => {
  const tools = captureTools(registerEcrituresTools, { groupId: 'g-1', scopeUniteIds: ['U-1'] });

  beforeEach(() => vi.clearAllMocks());

  it('délègue au service avec le contexte, l’imputation choisie et les montants FR en cents', async () => {
    fusionnerBrouillonsMock.mockResolvedValue({ ok: true, id: 'ECR-1', amount_cents: 15000, absorbes: ['ECR-2'], lignes_bancaires: [] });
    await tools.fusionner_brouillons.handler({
      cible_id: 'ECR-1',
      absorbes_ids: ['ECR-2'],
      description: 'Inscription famille Dupont',
      category_id: 'CAT-1',
      unite_id: 'U-1',
      activite_id: 'ACT-1',
      ventilations: [{ montant: '100,00', unite_id: 'U-LJ' }, { montant: '50,00' }],
    });
    expect(fusionnerBrouillonsMock).toHaveBeenCalledWith(
      { groupId: 'g-1', scopeUniteIds: ['U-1'] },
      {
        cibleId: 'ECR-1',
        absorbesIds: ['ECR-2'],
        description: 'Inscription famille Dupont',
        category_id: 'CAT-1',
        unite_id: 'U-1',
        activite_id: 'ACT-1',
        ventilations: [
          { amount_cents: 10000, category_id: null, unite_id: 'U-LJ', activite_id: null },
          { amount_cents: 5000, category_id: null, unite_id: null, activite_id: null },
        ],
      },
    );
  });

  it('renvoie l’écriture fusionnée et toutes ses lignes bancaires', async () => {
    const ok = {
      ok: true,
      id: 'ECR-1',
      amount_cents: 15000,
      absorbes: ['ECR-2'],
      lignes_bancaires: [
        { ecriture_id: 'ECR-1', ligne_bancaire_id: 201, ligne_bancaire_sous_index: null },
        { ecriture_id: 'ECR-2', ligne_bancaire_id: 202, ligne_bancaire_sous_index: null },
      ],
    };
    fusionnerBrouillonsMock.mockResolvedValue(ok);
    const r = (await tools.fusionner_brouillons.handler({ cible_id: 'ECR-1', absorbes_ids: ['ECR-2'] })) as { isError?: boolean };
    expect(r.isError).toBeUndefined();
    expect(parseToolResult(r)).toEqual(ok);
  });

  it('remonte le refus du service en erreur lisible', async () => {
    fusionnerBrouillonsMock.mockResolvedValue({ ok: false, message: 'Seuls des brouillons se fusionnent ; Refusé : ECR-2 (déjà dans Comptaweb).' });
    const r = (await tools.fusionner_brouillons.handler({ cible_id: 'ECR-1', absorbes_ids: ['ECR-2'] })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('ECR-2 (déjà dans Comptaweb)');
  });
});
