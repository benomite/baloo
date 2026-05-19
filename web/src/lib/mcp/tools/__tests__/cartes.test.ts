import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCarteTools } from '../cartes';

const FAKE = {
  id: 'carte-cb-leblanc',
  type: 'cb',
  porteur: 'LeBlanc',
  comptaweb_id: null,
  code_externe: null,
  statut: 'active',
};

vi.mock('@/lib/services/cartes', () => ({
  listCartes: vi.fn(async () => [FAKE]),
  createCarte: vi.fn(async () => FAKE),
  updateCarte: vi.fn(async () => FAKE),
}));

describe('cartes tools (Vague 2)', () => {
  const tools = captureTools(registerCarteTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose list/create/update_carte', () => {
    expect(Object.keys(tools).sort()).toEqual(['create_carte', 'list_cartes', 'update_carte']);
  });

  it('list_cartes retourne un JSON parsable', async () => {
    const r = await tools.list_cartes.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('carte-cb-leblanc');
  });

  it('create_carte confirme la création', async () => {
    const r = await tools.create_carte.handler({ type: 'cb', porteur: 'LeBlanc' });
    expect(parseToolResult(r) as string).toContain('carte-cb-leblanc');
  });

  it('update_carte confirme la mise à jour', async () => {
    const r = await tools.update_carte.handler({ id: 'carte-cb-leblanc', statut: 'ancienne' });
    expect(parseToolResult(r) as string).toContain('carte-cb-leblanc');
  });
});
