import { describe, it, expect } from 'vitest';
import { buildCampBudgetRows, type CampAgg } from './camp-budget';

const agg = (over: Partial<CampAgg> = {}): CampAgg => ({
  budgetDepenses: [{ categoryId: 'c1', categoryName: 'Intendance', amountCents: 180000 }],
  budgetRecettes: [{ categoryId: 'c9', categoryName: 'Participation activités', amountCents: 672000 }],
  ecrituresDepenses: [{ categoryId: 'c1', categoryName: 'Intendance', amountCents: 86400 }],
  depotsEnAttente: [{ categoryId: 'c1', categoryName: 'Intendance', amountCents: 37600 }],
  recettesEncaissees: 588000,
  ...over,
});

describe('buildCampBudgetRows', () => {
  it('fusionne budget + écritures + dépôts par poste', () => {
    const r = buildCampBudgetRows(agg());
    expect(r.postes).toEqual([
      { categoryId: 'c1', categoryName: 'Intendance', budgetCents: 180000, ecrituresCents: 86400, depotsCents: 37600, depenseCents: 124000 },
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
});
