import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerGroupeTools } from '../groupes';

const FAKE_GROUPE = {
  id: 'g-test',
  code: 'val-de-saone',
  nom: 'Val de Saône',
  territoire: 'Caluire',
  adresse: null,
  email_contact: null,
  iban_principal: null,
  notes: null,
  created_at: '2024-09-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

vi.mock('@/lib/services/groupes', () => ({
  getGroupe: vi.fn(async () => FAKE_GROUPE),
  updateGroupe: vi.fn(async () => FAKE_GROUPE),
}));

describe('groupes tools (Vague 1)', () => {
  const tools = captureTools(registerGroupeTools);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expose get/update_groupe', () => {
    expect(Object.keys(tools).sort()).toEqual(['get_groupe', 'update_groupe']);
  });

  it('get_groupe retourne le groupe en JSON', async () => {
    const r = await tools.get_groupe.handler({});
    const parsed = parseToolResult(r) as { id: string; nom: string };
    expect(parsed.id).toBe('g-test');
    expect(parsed.nom).toBe('Val de Saône');
  });

  it('update_groupe renvoie un message de confirmation', async () => {
    const r = await tools.update_groupe.handler({ nom: 'Val de Saône' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('g-test');
    expect(txt).toContain('mis à jour');
  });
});
