import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerSyncReferentielsTools } from '../sync-referentiels';

vi.mock('@/lib/comptaweb', () => ({
  withAutoReLogin: vi.fn(async (fn: (cfg: unknown) => unknown) => fn({})),
  fetchReferentielsCreer: vi.fn(async () => ({
    brancheprojet: [],
    nature: [],
    activite: [],
    modetransaction: [],
  })),
  fetchAllCartes: vi.fn(async () => []),
  applyReferentielsSync: vi.fn(async () => ({
    unites: { ajoutees: 1, mappees: 0, inchangees: 5, orphelines: [] },
    categories: { ajoutees: 0, mappees: 1, inchangees: 12, orphelines: ['cat-old'] },
    activites: { ajoutees: 2, mappees: 0, inchangees: 3, orphelines: [] },
    modes_paiement: { ajoutees: 0, mappees: 0, inchangees: 4, orphelines: [] },
    cartes: { ajoutees: 0, mappees: 0, inchangees: 2, orphelines: [] },
  })),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({ prepare: vi.fn() })),
}));

describe('cw_sync_referentiels tool (Vague 5)', () => {
  const tools = captureTools(registerSyncReferentielsTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose cw_sync_referentiels', () => {
    expect(Object.keys(tools)).toEqual(['cw_sync_referentiels']);
  });

  it('renvoie un rapport formaté lisible', async () => {
    const r = await tools.cw_sync_referentiels.handler({});
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('Unités');
    expect(txt).toContain('1 ajoutée');
    expect(txt).toContain('Orphelines');
    expect(txt).toContain('cat-old');
  });
});
