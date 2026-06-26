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
  taux_km_millicents: 354,
  created_at: '2024-09-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

const updateGroupeMock = vi.fn(async () => FAKE_GROUPE);

vi.mock('@/lib/services/groupes', () => ({
  getGroupe: vi.fn(async () => FAKE_GROUPE),
  updateGroupe: vi.fn((...args: Parameters<typeof updateGroupeMock>) => updateGroupeMock(...args)),
}));

describe('groupes tools (Vague 1 + Lot 3 taux_km)', () => {
  const tools = captureTools(registerGroupeTools);

  beforeEach(() => {
    vi.clearAllMocks();
    updateGroupeMock.mockResolvedValue(FAKE_GROUPE);
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

  // ─── Lot 3 : taux_km dans update_groupe ─────────────────────────────

  it('update_groupe convertit taux_km euros → millicents et transmet au service', async () => {
    await tools.update_groupe.handler({ taux_km: 0.354 });
    expect(updateGroupeMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'g-test' }),
      expect.objectContaining({ taux_km_millicents: 354 }),
    );
  });

  it('update_groupe sans taux_km ne transmet pas taux_km_millicents', async () => {
    await tools.update_groupe.handler({ nom: 'Nouveau nom' });
    const calls = updateGroupeMock.mock.calls as unknown[][];
    const patch = calls[0][1] as Record<string, unknown>;
    expect(patch.taux_km_millicents).toBeUndefined();
    expect(patch.nom).toBe('Nouveau nom');
  });

  it('update_groupe introuvable → message clair', async () => {
    updateGroupeMock.mockResolvedValue(null as unknown as typeof FAKE_GROUPE);
    const r = await tools.update_groupe.handler({ taux_km: 0.5 });
    expect(parseToolResult(r) as string).toContain('introuvable');
  });
});
