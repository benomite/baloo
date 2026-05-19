import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCompteTools } from '../comptes';

const FAKE = {
  id: 'cpt-bnp',
  group_id: 'g-test',
  code: 'bnp',
  nom: 'BNP courant',
  banque: 'BNP',
  iban: null,
  bic: null,
  type_compte: 'courant',
  comptaweb_id: null,
  statut: 'actif',
  ouvert_le: null,
  ferme_le: null,
  notes: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

vi.mock('@/lib/services/comptes', () => ({
  COMPTE_TYPES: ['courant', 'livret', 'caisse', 'autre'] as const,
  COMPTE_STATUTS: ['actif', 'ferme'] as const,
  listComptesBancaires: vi.fn(async () => [FAKE]),
  createCompteBancaire: vi.fn(async () => FAKE),
  updateCompteBancaire: vi.fn(async () => FAKE),
}));

describe('comptes tools (Vague 2)', () => {
  const tools = captureTools(registerCompteTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose list/create/update_compte_bancaire', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'create_compte_bancaire',
      'list_comptes_bancaires',
      'update_compte_bancaire',
    ]);
  });

  it('list_comptes_bancaires retourne un JSON parsable', async () => {
    const r = await tools.list_comptes_bancaires.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('cpt-bnp');
  });

  it('create_compte_bancaire confirme la création', async () => {
    const r = await tools.create_compte_bancaire.handler({ code: 'bnp', nom: 'BNP courant' });
    expect(parseToolResult(r) as string).toContain('cpt-bnp');
  });

  it('update_compte_bancaire confirme la mise à jour', async () => {
    const r = await tools.update_compte_bancaire.handler({ id: 'cpt-bnp', notes: 'OK' });
    expect(parseToolResult(r) as string).toContain('cpt-bnp');
  });
});
