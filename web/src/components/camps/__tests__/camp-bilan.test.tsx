// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CampBilanPanel } from '../camp-bilan';
import type { CampBilan } from '@/lib/services/camp-bilan';
import type { BilanEcriture } from '@/lib/services/camp-bilan-logic';

afterEach(cleanup);

// Les montants contiennent des NBSP (séparateur de milliers, avant le €).
// (plusieurs éléments peuvent porter le même texte : le <span> du montant
// et son parent) → on vérifie qu'au moins un existe.
const montant = (attendu: string) =>
  screen.getAllByText((_, el) => el?.textContent?.replace(/\u00a0/g, ' ') === attendu && el.tagName === 'SPAN').length > 0;

const ecr = (over: Partial<BilanEcriture> = {}): BilanEcriture => ({
  id: 'ECR-1',
  date_ecriture: '2026-07-10',
  description: 'Courses Leclerc',
  amount_cents: 12000,
  type: 'depense',
  category_id: 'cat-int',
  category_name: 'Intendance',
  has_justificatif: 1,
  remboursement_id: null,
  justif_attendu: 1,
  ...over,
});

const bilan = (over: Partial<CampBilan> = {}): CampBilan => ({
  camp: {
    id: 'CAMP-2026-001', group_id: 'g1', name: 'Camp été louveteaux', unite_id: 'UNI1',
    activite_id: 'ACT1', date_debut: '2026-07-08', date_fin: '2026-07-20', statut: 'cloture',
    notes: null, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  },
  resultat: { recettesCents: 588000, depensesCents: 124000, resultatCents: 464000, depotsEnAttenteCents: 0, resultatProjeteCents: 464000 },
  ecritures: [ecr()],
  justifs: { manquants: [], couvertsParRemboursement: [], nonAttendus: [] },
  depotsOrphelins: [],
  depotsSansImputationCount: 0,
  sansUniteCount: 0,
  avancesEnCirculation: [],
  avancesSummary: null,
  rows: { postes: [], totalBudgetDepensesCents: 0, totalDepenseCents: 0, totalNetCents: 0, totalBudgetRecettesCents: 0, recettesEncaisseesCents: 0, recettesHorsPosteCents: 0 },
  ...over,
});

describe('<CampBilanPanel>', () => {
  it('affiche recettes, dépenses et résultat', () => {
    render(<CampBilanPanel bilan={bilan()} />);
    expect(montant('+5 880,00 €')).toBe(true);
    expect(montant('-1 240,00 €')).toBe(true);
    // Résultat en tone « signed » : couleur seulement, pas de préfixe.
    expect(montant('4 640,00 €')).toBe(true);
  });

  it('camp sans rien à finir : le dit explicitement', () => {
    render(<CampBilanPanel bilan={bilan()} />);
    expect(screen.getByText('Rien à finir')).toBeTruthy();
  });

  it('liste les dépenses sans justificatif et les compte dans ce qui reste à finir', () => {
    const manquante = ecr({ id: 'ECR-9', description: 'Boulangerie', has_justificatif: 0 });
    render(
      <CampBilanPanel
        bilan={bilan({
          ecritures: [ecr(), manquante],
          justifs: { manquants: [manquante], couvertsParRemboursement: [], nonAttendus: [] },
        })}
      />,
    );
    expect(screen.queryByText('Rien à finir')).toBeNull();
    expect(screen.getByText(/dépense\(s\) sans justificatif/)).toBeTruthy();
    expect(screen.getAllByText('Boulangerie').length).toBeGreaterThan(0);
  });

  it('sépare les tickets en attente des tickets rejetés', () => {
    render(
      <CampBilanPanel
        bilan={bilan({
          depotsOrphelins: [
            { id: 'DEP-1', titre: 'Courses marché', amount_cents: 4200, date_estimee: '2026-07-12', statut: 'a_traiter', motif_rejet: null, category_name: 'Intendance', submitter_name: 'Akela', created_at: '2026-07-12T00:00:00Z' },
            { id: 'DEP-2', titre: 'Ticket illisible', amount_cents: null, date_estimee: null, statut: 'rejete', motif_rejet: 'photo floue', category_name: null, submitter_name: 'Baloo', created_at: '2026-07-13T00:00:00Z' },
          ],
        })}
      />,
    );
    expect(screen.getByText('En attente de rattachement')).toBeTruthy();
    expect(screen.getByText('Rejetés')).toBeTruthy();
    expect(screen.getByText('Rejeté : photo floue')).toBeTruthy();
  });

  it('annonce le résultat projeté quand des tickets ne sont pas rapprochés', () => {
    render(
      <CampBilanPanel
        bilan={bilan({
          resultat: { recettesCents: 100000, depensesCents: 30000, resultatCents: 70000, depotsEnAttenteCents: 25000, resultatProjeteCents: 45000 },
        })}
      />,
    );
    expect(screen.getByText(/tickets déposés ne sont/)).toBeTruthy();
    expect(montant('450,00 €')).toBe(true);
  });

  it('signale les dépôts du groupe sans imputation, invisibles de tout camp', () => {
    render(<CampBilanPanel bilan={bilan({ depotsSansImputationCount: 2 })} />);
    expect(screen.getByText(/n’apparaissent\s+dans\s+aucun camp/)).toBeTruthy();
  });

  // Cas terrain camp bleu 2026 : caution de camion payée puis rendue sur la
  // même catégorie. Le tableau montrait 1215,23 € de « réalisé » pour un
  // coût réel de 625,23 €, sans trace de la recette qui l'annule.
  const posteLoc = (recettesCents: number) => ({
    categoryId: 'cat-loc', categoryName: 'Location véhicule',
    budgetCents: 0, ecrituresCents: 121523, depotsCents: 0, depenseCents: 121523,
    recettesCents, netCents: 121523 - recettesCents,
  });

  it('poste remboursé : colonnes Remboursé et Coût réel', () => {
    render(<CampBilanPanel bilan={bilan({
      rows: {
        postes: [posteLoc(59000)],
        totalBudgetDepensesCents: 0, totalDepenseCents: 121523, totalNetCents: 62523,
        totalBudgetRecettesCents: 0, recettesEncaisseesCents: 59000, recettesHorsPosteCents: 0,
      },
    })} />);
    expect(screen.getByText('Remboursé')).toBeTruthy();
    expect(screen.getByText('Coût réel')).toBeTruthy();
    expect(montant('1 215,23 €')).toBe(true);
    expect(montant('+590,00 €')).toBe(true);
    expect(montant('625,23 €')).toBe(true);
  });

  it('aucun poste remboursé : le tableau reste à 4 colonnes', () => {
    render(<CampBilanPanel bilan={bilan({
      rows: {
        postes: [posteLoc(0)],
        totalBudgetDepensesCents: 0, totalDepenseCents: 121523, totalNetCents: 121523,
        totalBudgetRecettesCents: 0, recettesEncaisseesCents: 0, recettesHorsPosteCents: 0,
      },
    })} />);
    expect(screen.queryByText('Remboursé')).toBeNull();
    expect(screen.queryByText('Coût réel')).toBeNull();
  });
});
