import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureTools, parseToolResult } from './test-helpers';
import { registerCampsTools } from '../camps';

const FAKE_CAMP = {
  id: 'CAMP-2026-001',
  group_id: 'g-test',
  name: 'Camp été Castors 2026',
  unite_id: 'u-castors',
  activite_id: 'act-camp-ete',
  date_debut: '2026-07-05',
  date_fin: '2026-07-19',
  statut: 'preparation' as const,
  notes: null,
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-01T10:00:00Z',
  unite_code: 'CAS',
  unite_name: 'Castors',
  unite_couleur: '#FFA500',
  activite_name: 'Camp été 2026',
};

const FAKE_AVANCE = {
  id: 'AVC-2026-001',
  group_id: 'g-test',
  camp_id: 'CAMP-2026-001',
  beneficiaire: 'Jean Dupont',
  montant_cents: 50000,
  date_versement: '2026-06-15',
  mode: 'virement' as const,
  ecriture_id: null,
  statut: 'versee' as const,
  montant_rendu_cents: null,
  notes: null,
  created_at: '2026-06-15T08:00:00Z',
  updated_at: '2026-06-15T08:00:00Z',
};

const FAKE_SUMMARY = {
  totalVerseCents: 50000,
  enCirculationCents: 50000,
  totalRenduCents: 0,
  consommeCents: 0,
  enCoursCount: 1,
};

vi.mock('@/lib/services/camps', () => ({
  listCamps: vi.fn(async () => [FAKE_CAMP]),
  createCamp: vi.fn(async () => FAKE_CAMP),
  updateCampStatut: vi.fn(async () => ({ ok: true })),
  CAMP_STATUTS: ['preparation', 'en_cours', 'cloture'],
}));

vi.mock('@/lib/services/camp-avances', () => ({
  listAvancesForCamp: vi.fn(async () => ({
    avances: [FAKE_AVANCE],
    summary: FAKE_SUMMARY,
  })),
  createAvance: vi.fn(async () => ({ ok: true })),
  cloturerAvance: vi.fn(async () => ({ ok: true, campId: 'CAMP-2026-001' })),
  rouvrirAvance: vi.fn(async () => ({ ok: true, campId: 'CAMP-2026-001' })),
  AVANCE_MODES: ['virement', 'especes'],
}));

describe('camps tools (Lot 2)', () => {
  const tools = captureTools(registerCampsTools);
  beforeEach(() => vi.clearAllMocks());

  it('expose les 7 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'cloturer_avance_camp',
      'create_avance_camp',
      'create_camp',
      'list_avances_camp',
      'list_camps',
      'rouvrir_avance_camp',
      'update_camp',
    ]);
  });

  it('list_camps retourne un tableau JSON parsable', async () => {
    const r = await tools.list_camps.handler({});
    const parsed = parseToolResult(r) as Array<{ id: string; name: string }>;
    expect(parsed[0].id).toBe('CAMP-2026-001');
    expect(parsed[0].name).toBe('Camp été Castors 2026');
  });

  it('list_camps filtre par statut (passé au service + filtre local)', async () => {
    const r = await tools.list_camps.handler({ statut: 'preparation' });
    const parsed = parseToolResult(r) as Array<{ statut: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].statut).toBe('preparation');
  });

  it('list_camps filtre exclut les camps non correspondants', async () => {
    const r = await tools.list_camps.handler({ statut: 'cloture' });
    const parsed = parseToolResult(r) as Array<unknown>;
    expect(parsed).toHaveLength(0);
  });

  it('create_camp retourne le camp créé en JSON', async () => {
    const r = await tools.create_camp.handler({
      name: 'Camp été Castors 2026',
      unite_id: 'u-castors',
      activite_id: 'act-camp-ete',
      date_debut: '2026-07-05',
      date_fin: '2026-07-19',
    });
    const parsed = parseToolResult(r) as { id: string; statut: string };
    expect(parsed.id).toBe('CAMP-2026-001');
    expect(parsed.statut).toBe('preparation');
  });

  it('update_camp confirme la mise à jour', async () => {
    const r = await tools.update_camp.handler({ id: 'CAMP-2026-001', statut: 'en_cours' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('CAMP-2026-001');
    expect(txt).toContain('en_cours');
  });

  it('update_camp remonte une erreur si le service échoue', async () => {
    const { updateCampStatut } = await import('@/lib/services/camps');
    vi.mocked(updateCampStatut).mockResolvedValueOnce({ ok: false, error: 'Camp introuvable.' });
    const r = await tools.update_camp.handler({ id: 'CAMP-INCONNU', statut: 'cloture' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('Erreur');
    expect(txt).toContain('Camp introuvable');
  });

  it('list_avances_camp formate les montants', async () => {
    const r = await tools.list_avances_camp.handler({ camp_id: 'CAMP-2026-001' });
    const parsed = parseToolResult(r) as {
      avances: Array<{ montant: string }>;
      summary: { totalVerse: string; enCoursCount: number };
    };
    expect(parsed.avances[0].montant).toMatch(/500,00/);
    expect(parsed.summary.totalVerse).toMatch(/500,00/);
    expect(parsed.summary.enCoursCount).toBe(1);
  });

  it('list_avances_camp retourne un message si camp introuvable', async () => {
    const { listAvancesForCamp } = await import('@/lib/services/camp-avances');
    vi.mocked(listAvancesForCamp).mockResolvedValueOnce(null);
    const r = await tools.list_avances_camp.handler({ camp_id: 'CAMP-INCONNU' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('introuvable');
  });

  it('create_avance_camp parse le montant et confirme', async () => {
    const r = await tools.create_avance_camp.handler({
      camp_id: 'CAMP-2026-001',
      beneficiaire: 'Jean Dupont',
      montant: '500,00',
      mode: 'virement',
      date_versement: '2026-06-15',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('500,00');
    expect(txt).toContain('Jean Dupont');
  });

  it('create_avance_camp remonte une erreur si le service refuse', async () => {
    const { createAvance } = await import('@/lib/services/camp-avances');
    vi.mocked(createAvance).mockResolvedValueOnce({ ok: false, error: 'Mode invalide : cb.' });
    const r = await tools.create_avance_camp.handler({
      camp_id: 'CAMP-2026-001',
      beneficiaire: 'Jean Dupont',
      montant: '100,00',
      mode: 'especes',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('Erreur');
  });

  it('cloturer_avance_camp parse le montant rendu et confirme', async () => {
    const r = await tools.cloturer_avance_camp.handler({
      id: 'AVC-2026-001',
      montant_rendu: '42,50',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('AVC-2026-001');
    expect(txt).toContain('42,50');
  });

  it('cloturer_avance_camp accepte 0 comme montant rendu', async () => {
    const r = await tools.cloturer_avance_camp.handler({
      id: 'AVC-2026-001',
      montant_rendu: '0',
    });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('clôturée');
  });

  it('rouvrir_avance_camp confirme la réouverture', async () => {
    const r = await tools.rouvrir_avance_camp.handler({ id: 'AVC-2026-001' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('AVC-2026-001');
    expect(txt).toContain("'versee'");
  });

  it('rouvrir_avance_camp remonte une erreur si le service refuse', async () => {
    const { rouvrirAvance } = await import('@/lib/services/camp-avances');
    vi.mocked(rouvrirAvance).mockResolvedValueOnce({ ok: false, error: 'Avance non clôturée.' });
    const r = await tools.rouvrir_avance_camp.handler({ id: 'AVC-2026-001' });
    const txt = parseToolResult(r) as string;
    expect(txt).toContain('Erreur');
    expect(txt).toContain('non clôturée');
  });
});
