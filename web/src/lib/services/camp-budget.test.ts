import { describe, it, expect } from 'vitest';
import { buildCampBudgetRows, type CampAgg } from './camp-budget';

const agg = (over: Partial<CampAgg> = {}): CampAgg => ({
  budgetDepenses: [{ categoryId: 'c1', categoryName: 'Intendance', amountCents: 180000 }],
  budgetRecettes: [{ categoryId: 'c9', categoryName: 'Participation activités', amountCents: 672000 }],
  ecrituresDepenses: [{ categoryId: 'c1', categoryName: 'Intendance', amountCents: 86400 }],
  depotsEnAttente: [{ categoryId: 'c1', categoryName: 'Intendance', amountCents: 37600 }],
  recettesParCategorie: [{ categoryId: 'c9', categoryName: 'Participation activités', amountCents: 588000 }],
  recettesEncaissees: 588000,
  ...over,
});

describe('buildCampBudgetRows', () => {
  it('fusionne budget + écritures + dépôts par poste', () => {
    const r = buildCampBudgetRows(agg());
    expect(r.postes).toEqual([
      { categoryId: 'c1', categoryName: 'Intendance', budgetCents: 180000, ecrituresCents: 86400, depotsCents: 37600, depenseCents: 124000, recettesCents: 0, netCents: 124000 },
    ]);
    expect(r.totalDepenseCents).toBe(124000);
    expect(r.totalBudgetDepensesCents).toBe(180000);
  });
  it('poste sans budget mais avec dépense → ligne budget 0', () => {
    const r = buildCampBudgetRows(agg({ budgetDepenses: [] }));
    expect(r.postes[0].budgetCents).toBe(0);
    expect(r.postes[0].depenseCents).toBe(124000);
  });
  it('poste budgété sans dépense → ligne dépensé 0', () => {
    const r = buildCampBudgetRows(agg({ ecrituresDepenses: [], depotsEnAttente: [] }));
    expect(r.postes[0].depenseCents).toBe(0);
  });
  it('catégorie null regroupée sous (non catégorisé)', () => {
    const r = buildCampBudgetRows(agg({
      ecrituresDepenses: [{ categoryId: null, categoryName: null, amountCents: 5000 }],
      budgetDepenses: [], depotsEnAttente: [],
    }));
    expect(r.postes[0].categoryName).toBe('(non catégorisé)');
  });
  it('recettes : encaissé + budget', () => {
    const r = buildCampBudgetRows(agg());
    expect(r.recettesEncaisseesCents).toBe(588000);
    expect(r.totalBudgetRecettesCents).toBe(672000);
  });
  it('tri : postes par budget décroissant puis dépensé décroissant', () => {
    const r = buildCampBudgetRows(agg({
      budgetDepenses: [
        { categoryId: 'c2', categoryName: 'Transport', amountCents: 60000 },
        { categoryId: 'c1', categoryName: 'Intendance', amountCents: 180000 },
      ],
    }));
    expect(r.postes.map((p) => p.categoryId)).toEqual(['c1', 'c2']);
  });

  // Cas terrain camp bleu 2026 : caution de camion payée 590 € puis
  // remboursée 590 € sur la même catégorie. Le poste affichait 1215,23 €
  // de « réalisé » pour un coût réel de 625,23 € — la recette qui l'annule
  // n'apparaissait nulle part dans le tableau.
  it('poste dont une dépense a été remboursée : brut et net distincts', () => {
    const loc = (amountCents: number) => ({ categoryId: 'cat-loc', categoryName: 'Location véhicule', amountCents });
    const r = buildCampBudgetRows(agg({
      budgetDepenses: [],
      ecrituresDepenses: [loc(59000 + 61600 + 923)],
      depotsEnAttente: [],
      recettesParCategorie: [loc(59000)],
      recettesEncaissees: 59000,
    }));
    const poste = r.postes.find((p) => p.categoryId === 'cat-loc')!;
    expect(poste.depenseCents).toBe(121523);
    expect(poste.recettesCents).toBe(59000);
    expect(poste.netCents).toBe(62523);
    expect(r.totalNetCents).toBe(62523);
  });

  // Une recette sur une catégorie qui n'est pas un poste de dépense
  // (participations des familles…) ne doit PAS créer de ligne dans le
  // tableau des dépenses — mais son montant reste traçable.
  it('une recette hors poste de dépense ne crée pas de ligne', () => {
    const r = buildCampBudgetRows(agg());
    expect(r.postes.map((p) => p.categoryId)).toEqual(['c1']);
    expect(r.recettesHorsPosteCents).toBe(588000);
    expect(
      r.postes.reduce((s, p) => s + p.recettesCents, 0) + r.recettesHorsPosteCents,
    ).toBe(r.recettesEncaisseesCents);
  });
});
