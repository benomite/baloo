import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerPersonneTools } from '../personnes';

const FAKE_PERSONNE = {
  id: 'per-jean-dupont',
  group_id: 'g-test',
  prenom: 'Jean',
  nom: 'Dupont',
  email: 'jean@example.com',
  telephone: null,
  role_groupe: 'tresorier',
  unite_id: null,
  statut: 'actif',
  depuis: '2026-01-01',
  jusqu_a: null,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

vi.mock('@/lib/services/personnes', () => ({
  PERSONNE_ROLES: ['tresorier', 'co-rg', 'chef_unite', 'autre'] as const,
  listPersonnes: vi.fn(async () => [FAKE_PERSONNE]),
  createPersonne: vi.fn(async () => FAKE_PERSONNE),
  updatePersonne: vi.fn(async () => FAKE_PERSONNE),
}));

describe('personnes tools (Vague 1)', () => {
  const tools = captureTools(registerPersonneTools);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expose list/create/update_personne', () => {
    expect(Object.keys(tools).sort()).toEqual(['create_personne', 'list_personnes', 'update_personne']);
  });

  it('list_personnes retourne un JSON parsable', async () => {
    const r = await tools.list_personnes.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string }>;
    expect(parsed[0].id).toBe('per-jean-dupont');
  });

  it('create_personne renvoie un message de confirmation incluant l\'id', async () => {
    const r = await tools.create_personne.handler({ prenom: 'Jean', nom: 'Dupont' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('per-jean-dupont');
    expect(txt).toContain('Jean');
  });

  it('update_personne renvoie un message de confirmation', async () => {
    const r = await tools.update_personne.handler({ id: 'per-jean-dupont', notes: 'Mandat clos' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('per-jean-dupont');
    expect(txt).toContain('mise à jour');
  });
});
