import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerReferenceTools } from '../reference';

vi.mock('@/lib/services/reference', () => ({
  listCategories: vi.fn(async () => [{ id: 'cat-1', name: 'Cotisations' }]),
  listUnites: vi.fn(async () => [{ id: 'u-1', code: 'LJ', name: 'Louveteaux' }]),
  listModesPaiement: vi.fn(async () => [{ id: 'mp-1', name: 'CB' }]),
  listActivites: vi.fn(async () => [{ id: 'act-1', name: 'Camp' }]),
}));

describe('reference tools (Vague 1)', () => {
  const tools = captureTools(registerReferenceTools);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expose les 4 tools référentiels', () => {
    expect(Object.keys(tools).sort()).toEqual(
      ['list_activites', 'list_categories', 'list_modes_paiement', 'list_unites'],
    );
  });

  it('list_categories retourne un JSON parsable', async () => {
    const r = await tools.list_categories.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('cat-1');
  });

  it('list_unites retourne un JSON parsable', async () => {
    const r = await tools.list_unites.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('u-1');
  });

  it('list_modes_paiement retourne un JSON parsable', async () => {
    const r = await tools.list_modes_paiement.handler({});
    expect(parseToolResult(r)).toEqual([{ id: 'mp-1', name: 'CB' }]);
  });

  it('list_activites retourne un JSON parsable', async () => {
    const r = await tools.list_activites.handler({});
    expect(parseToolResult(r)).toEqual([{ id: 'act-1', name: 'Camp' }]);
  });
});
