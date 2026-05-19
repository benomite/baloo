import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerInboxTools } from '../inbox';

vi.mock('@/lib/queries/inbox', () => ({
  INBOX_PERIODS: ['30j', '90j', '6mois', 'tout'] as const,
  listInboxItems: vi.fn(async () => ({
    suggestions: [],
    ecrituresOrphelines: [{ id: 'DEP-001', amount_cents: 1000 }],
    justifsOrphelins: [{ id: 'JUS-001', titre: 'Facture A' }],
    totalCount: 0,
    ecrituresTruncated: 0,
  })),
  findSuggestionsForEcriture: vi.fn(async () => [{ ecriture: { id: 'DEP-001' }, justif: { id: 'JUS-001' } }]),
  findSuggestionsForDepot: vi.fn(async () => [{ ecriture: { id: 'DEP-001' }, justif: { id: 'JUS-001' } }]),
}));

vi.mock('@/lib/services/depots', () => ({
  attachDepotToEcriture: vi.fn(async () => ({
    id: 'JUS-001',
    statut: 'rattache',
    ecriture_id: 'DEP-001',
  })),
}));

vi.mock('@/lib/services/inbox-auto', () => ({
  applyAutoLinks: vi.fn(async () => ({ pairs: [['DEP-001', 'JUS-001']] })),
}));

describe('inbox tools (Vague 5)', () => {
  const tools = captureTools(registerInboxTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 5 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'inbox_auto_match',
      'inbox_link',
      'inbox_list_orphan_ecritures',
      'inbox_list_orphan_justifs',
      'inbox_suggest_matches',
    ]);
  });

  it('inbox_list_orphan_ecritures retourne ecritures + period', async () => {
    const r = await tools.inbox_list_orphan_ecritures.handler({ period: '30j' });
    const parsed = parseToolResult(r) as { period: string; count: number };
    expect(parsed.period).toBe('30j');
    expect(parsed.count).toBe(1);
  });

  it('inbox_list_orphan_justifs retourne depots', async () => {
    const r = await tools.inbox_list_orphan_justifs.handler({});
    const parsed = parseToolResult(r) as { count: number; depots: Array<{ id: string }> };
    expect(parsed.count).toBe(1);
    expect(parsed.depots[0].id).toBe('JUS-001');
  });

  it('inbox_suggest_matches refuse l\'absence des deux IDs', async () => {
    const r = await tools.inbox_suggest_matches.handler({});
    expect(parseToolResult(r) as string).toContain('exactement un');
  });

  it('inbox_suggest_matches refuse les deux IDs ensemble', async () => {
    const r = await tools.inbox_suggest_matches.handler({ ecriture_id: 'DEP-001', depot_id: 'JUS-001' });
    expect(parseToolResult(r) as string).toContain('exactement un');
  });

  it('inbox_suggest_matches retourne les matches pour une ecriture', async () => {
    const r = await tools.inbox_suggest_matches.handler({ ecriture_id: 'DEP-001' });
    const parsed = parseToolResult(r) as { ecriture_id: string; matches: unknown[] };
    expect(parsed.ecriture_id).toBe('DEP-001');
    expect(parsed.matches).toHaveLength(1);
  });

  it('inbox_link relie ecriture + depot', async () => {
    const r = await tools.inbox_link.handler({ ecriture_id: 'DEP-001', depot_id: 'JUS-001' });
    const parsed = parseToolResult(r) as { ok: boolean; depot: { id: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.depot.id).toBe('JUS-001');
  });

  it('inbox_auto_match renvoie les paires liées', async () => {
    const r = await tools.inbox_auto_match.handler({});
    const parsed = parseToolResult(r) as { linked: unknown[] };
    expect(parsed.linked).toHaveLength(1);
  });
});
