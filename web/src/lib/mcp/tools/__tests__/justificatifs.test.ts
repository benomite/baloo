import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerJustificatifTools } from '../justificatifs';

vi.mock('@/lib/services/justificatifs', () => ({
  listJustificatifs: vi.fn(async () => [
    {
      id: 'JUS-001',
      group_id: 'g-test',
      entity_type: 'ecriture',
      entity_id: 'DEP-001',
      file_path: '/blob/jus-001.pdf',
      uploaded_at: '2026-05-18',
    },
  ]),
}));

describe('justificatifs tool (Vague 3)', () => {
  const tools = captureTools(registerJustificatifTools);
  beforeEach(() => vi.clearAllMocks());

  it("expose list_justificatifs uniquement (pas d'attach/upload)", () => {
    expect(Object.keys(tools)).toEqual(['list_justificatifs']);
  });

  it('list_justificatifs retourne un JSON parsable', async () => {
    const r = await tools.list_justificatifs.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('JUS-001');
  });
});
