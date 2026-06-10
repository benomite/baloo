// Fusion pure budget/réel d'un camp par poste de dépense (catégorie).
// Réel = écritures imputées à l'activité + dépôts a_traiter (temps réel
// pendant le camp ; un dépôt rattaché ne compte plus, l'écriture liée
// prend le relais — dédup assurée en amont par les requêtes). Cf. spec
// 2026-06-10-camps-design.md.

export interface CatAmount {
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
}

export interface CampAgg {
  budgetDepenses: CatAmount[];
  budgetRecettes: CatAmount[];
  ecrituresDepenses: CatAmount[];
  depotsEnAttente: CatAmount[];
  recettesEncaissees: number;
}

export interface CampPoste {
  categoryId: string | null;
  categoryName: string;
  budgetCents: number;
  ecrituresCents: number;
  depotsCents: number;
  depenseCents: number; // ecritures + depots
}

export interface CampBudgetRows {
  postes: CampPoste[];
  totalBudgetDepensesCents: number;
  totalDepenseCents: number;
  totalBudgetRecettesCents: number;
  recettesEncaisseesCents: number;
}

const keyOf = (c: CatAmount) => c.categoryId ?? '__none__';
const nameOf = (c: CatAmount) => c.categoryName ?? '(non catégorisé)';

export function buildCampBudgetRows(agg: CampAgg): CampBudgetRows {
  const postes = new Map<string, CampPoste>();
  const ensure = (c: CatAmount): CampPoste => {
    const k = keyOf(c);
    let p = postes.get(k);
    if (!p) {
      p = { categoryId: c.categoryId, categoryName: nameOf(c), budgetCents: 0, ecrituresCents: 0, depotsCents: 0, depenseCents: 0 };
      postes.set(k, p);
    }
    return p;
  };
  for (const c of agg.budgetDepenses) ensure(c).budgetCents += c.amountCents;
  for (const c of agg.ecrituresDepenses) ensure(c).ecrituresCents += c.amountCents;
  for (const c of agg.depotsEnAttente) ensure(c).depotsCents += c.amountCents;
  for (const p of postes.values()) p.depenseCents = p.ecrituresCents + p.depotsCents;

  const rows = Array.from(postes.values()).sort(
    (a, b) => b.budgetCents - a.budgetCents || b.depenseCents - a.depenseCents,
  );
  return {
    postes: rows,
    totalBudgetDepensesCents: rows.reduce((s, p) => s + p.budgetCents, 0),
    totalDepenseCents: rows.reduce((s, p) => s + p.depenseCents, 0),
    totalBudgetRecettesCents: agg.budgetRecettes.reduce((s, c) => s + c.amountCents, 0),
    recettesEncaisseesCents: agg.recettesEncaissees,
  };
}
