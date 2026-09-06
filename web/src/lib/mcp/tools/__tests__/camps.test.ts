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

const FAKE_BILAN = {
  camp: FAKE_CAMP,
  resultat: {
    recettesCents: 588000, depensesCents: 124000, resultatCents: 464000,
    depotsEnAttenteCents: 4200, resultatProjeteCents: 459800,
  },
  ecritures: [
    { id: 'ECR-1', date_ecriture: '2026-07-10', description: 'Courses Leclerc', amount_cents: 12000, type: 'depense', category_id: 'cat-int', category_name: 'Intendance', has_justificatif: 1, remboursement_id: null, justif_attendu: 1 },
    { id: 'ECR-2', date_ecriture: '2026-07-12', description: 'Boulangerie', amount_cents: 3500, type: 'depense', category_id: 'cat-int', category_name: 'Intendance', has_justificatif: 0, remboursement_id: null, justif_attendu: 1 },
  ],
  justifs: {
    manquants: [{ id: 'ECR-2', date_ecriture: '2026-07-12', description: 'Boulangerie', amount_cents: 3500, type: 'depense', category_id: 'cat-int', category_name: 'Intendance', has_justificatif: 0, remboursement_id: null, justif_attendu: 1 }],
    couvertsParRemboursement: [],
    nonAttendus: [],
  },
  depotsOrphelins: [
    { id: 'DEP-1', titre: 'Courses marché', amount_cents: 4200, date_estimee: '2026-07-12', statut: 'a_traiter', motif_rejet: null, category_name: 'Intendance', submitter_name: 'Akela', created_at: '2026-07-12T00:00:00Z' },
    { id: 'DEP-2', titre: 'Ticket illisible', amount_cents: null, date_estimee: null, statut: 'rejete', motif_rejet: 'photo floue', category_name: null, submitter_name: 'Baloo', created_at: '2026-07-13T00:00:00Z' },
  ],
  depotsSansImputationCount: 2,
  sansUniteCount: 1,
  avancesEnCirculation: [FAKE_AVANCE],
  avancesSummary: FAKE_SUMMARY,
  rows: {
    postes: [{ categoryId: 'cat-int', categoryName: 'Intendance', budgetCents: 180000, ecrituresCents: 124000, depotsCents: 4200, depenseCents: 128200 }],
    totalBudgetDepensesCents: 180000, totalDepenseCents: 128200,
    totalBudgetRecettesCents: 672000, recettesEncaisseesCents: 588000,
  },
};

vi.mock('@/lib/services/camp-bilan', () => ({
  getCampBilan: vi.fn(async () => FAKE_BILAN),
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

  it('expose les 8 tools attendus', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'bilan_camp',
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

describe('bilan_camp', () => {
  const tools = captureTools(registerCampsTools);
  // formatAmount met un NBSP avant le € : on normalise pour comparer.
  const eur = (v: string | null | undefined) => v?.replace(/\u00a0/g, ' ');
  beforeEach(() => vi.clearAllMocks());

  it('formate le résultat du camp en euros', async () => {
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-2026-001' });
    const p = parseToolResult(r) as { resultat: Record<string, string> };
    expect(eur(p.resultat.recettes)).toBe('5880,00 €');
    expect(eur(p.resultat.depenses)).toBe('1240,00 €');
    expect(eur(p.resultat.resultat)).toBe('4640,00 €');
    expect(p.resultat.tickets_en_attente).toMatch(/42,00/);
    expect(eur(p.resultat.resultat_projete)).toBe('4598,00 €');
  });

  it('compte ce qui reste à finir avant clôture', async () => {
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-2026-001' });
    const p = parseToolResult(r) as { a_finir: Record<string, number> };
    expect(p.a_finir).toEqual({
      justifs_manquants: 1,
      tickets_non_rattaches: 1,
      avances_en_circulation: 1,
      ecritures_activite_sans_unite: 1,
      depots_groupe_sans_imputation: 2,
    });
  });

  it('liste les dépenses sans justificatif avec leur montant', async () => {
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-2026-001' });
    const p = parseToolResult(r) as { justificatifs: { manquants: Array<{ id: string; montant: string }> } };
    expect(p.justificatifs.manquants[0].id).toBe('ECR-2');
    expect(p.justificatifs.manquants[0].montant).toMatch(/35,00/);
  });

  it('liste les dépôts liés à rien, en attente comme rejetés', async () => {
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-2026-001' });
    const p = parseToolResult(r) as { depots_lies_a_rien: Array<{ id: string; statut: string; montant: string | null; motif_rejet: string | null }> };
    expect(p.depots_lies_a_rien.map((d) => d.id)).toEqual(['DEP-1', 'DEP-2']);
    expect(p.depots_lies_a_rien[0].montant).toMatch(/42,00/);
    expect(p.depots_lies_a_rien[1].montant).toBeNull();
    expect(p.depots_lies_a_rien[1].motif_rejet).toBe('photo floue');
  });

  it('renvoie le budget par poste avec son écart', async () => {
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-2026-001' });
    const p = parseToolResult(r) as { budget_vs_realise: Array<{ poste: string; budget: string; realise: string; ecart: string }> };
    expect(p.budget_vs_realise[0].poste).toBe('Intendance');
    expect(eur(p.budget_vs_realise[0].realise)).toBe('1282,00 €');
    expect(p.budget_vs_realise[0].ecart).toMatch(/518,00/);
  });

  it('marque chaque écriture comme justifiée ou non', async () => {
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-2026-001' });
    const p = parseToolResult(r) as { ecritures: Array<{ id: string; justificatif: boolean }> };
    expect(p.ecritures.find((e) => e.id === 'ECR-1')?.justificatif).toBe(true);
    expect(p.ecritures.find((e) => e.id === 'ECR-2')?.justificatif).toBe(false);
  });

  it('répond « Camp introuvable » quand le camp n’existe pas ou est hors scope', async () => {
    const { getCampBilan } = await import('@/lib/services/camp-bilan');
    vi.mocked(getCampBilan).mockResolvedValueOnce(null);
    const r = await tools.bilan_camp.handler({ camp_id: 'CAMP-INCONNU' });
    expect(parseToolResult(r)).toContain('Camp introuvable');
  });
});
