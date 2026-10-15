import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerSyncReferentielsTools } from '../sync-referentiels';

vi.mock('@/lib/services/referentiels-sync', () => ({
  syncReferentielsTousExercices: vi.fn(async () => ({
    exercices: ['2025-2026', '2026-2027'],
    unites: { ajoutees: 1, mappees: 0, inchangees: 5, orphelines: [] },
    categories: { ajoutees: 0, mappees: 1, inchangees: 12, orphelines: ['cat-old'] },
    activites: { ajoutees: 2, mappees: 0, inchangees: 3, orphelines: [] },
    modes_paiement: { ajoutees: 0, mappees: 0, inchangees: 4, orphelines: [] },
    cartes: { ajoutees: 0, mappees: 0, inchangees: 2, orphelines: [] },
  })),
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
    expect(txt).toContain('2025-2026, 2026-2027');
  });
});
