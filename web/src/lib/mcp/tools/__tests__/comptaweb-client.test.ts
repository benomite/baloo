import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerComptawebClientTools } from '../comptaweb-client';

vi.mock('@/lib/comptaweb', () => ({
  withAutoReLogin: vi.fn(async (fn: (cfg: unknown) => unknown) => fn({})),
  listRapprochementBancaire: vi.fn(async () => ({
    idCompte: 1,
    libelleCompte: 'BNP',
    ecrituresComptables: [
      {
        id: 1,
        dateEcriture: '2026-05-10',
        type: 'depense',
        intitule: 'Test',
        devise: 'EUR',
        montantCentimes: 5000,
        numeroPiece: 'P-1',
        modeTransaction: 'VIR',
        tiers: null,
      },
    ],
    ecrituresBancaires: [
      {
        id: 100,
        dateOperation: '2026-05-10',
        intitule: 'PAIEMENT TEST',
        montantCentimes: -5000,
        sousLignes: [{ montantCentimes: -5000, commercant: 'TEST' }],
      },
    ],
  })),
  fetchReferentielsCreer: vi.fn(async () => ({
    depenserecette: [],
    devise: [],
    modetransaction: [],
    comptebancaire: [],
    chequier: [],
    cartebancaire: [],
    carteprocurement: [],
    caisse: [],
    tierscateg: [],
    tiersstructure: [],
    nature: [{ id: '1', label: 'Cotisations' }],
    activite: [],
    brancheprojet: [],
  })),
}));

describe('comptaweb-client tools (Vague 5)', () => {
  const tools = captureTools(registerComptawebClientTools);
  beforeEach(() => vi.clearAllMocks());

  it("expose les 2 tools de lecture (sans cw_ecriture_depuis_ligne_bancaire)", () => {
    expect(Object.keys(tools).sort()).toEqual([
      'cw_list_rapprochement_bancaire',
      'cw_referentiels_creer_ecriture',
    ]);
  });

  it('cw_list_rapprochement_bancaire formate les montants', async () => {
    const r = await tools.cw_list_rapprochement_bancaire.handler({});
    const parsed = parseToolResult(r) as {
      compte: { id: number };
      ecritures_comptables_non_rapprochees: Array<{ montant: string }>;
    };
    expect(parsed.compte.id).toBe(1);
    expect(parsed.ecritures_comptables_non_rapprochees[0].montant).toMatch(/50,00/);
  });

  it('cw_referentiels_creer_ecriture renvoie les listes', async () => {
    const r = await tools.cw_referentiels_creer_ecriture.handler({});
    const parsed = parseToolResult(r) as { nature: Array<{ id: string }> };
    expect(parsed.nature[0].id).toBe('1');
  });
});
