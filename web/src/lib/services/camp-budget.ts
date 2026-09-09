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
  /** Recettes du camp ventilées par catégorie (mêmes écritures que
   *  `recettesEncaissees`, juste éclatées par poste). */
  recettesParCategorie: CatAmount[];
  recettesEncaissees: number;
}

export interface CampPoste {
  categoryId: string | null;
  categoryName: string;
  budgetCents: number;
  ecrituresCents: number;
  depotsCents: number;
  depenseCents: number; // ecritures + depots
  /** Recettes imputées au MÊME poste : une caution rendue, un
   *  remboursement de fournisseur, une refacturation. */
  recettesCents: number;
  /** Coût réel du poste : depenseCents − recettesCents. */
  netCents: number;
}

export interface CampBudgetRows {
  postes: CampPoste[];
  totalBudgetDepensesCents: number;
  totalDepenseCents: number;
  totalNetCents: number;
  totalBudgetRecettesCents: number;
  recettesEncaisseesCents: number;
  /** Recettes sur des catégories qui ne sont pas des postes de dépense
   *  (participations des familles, subventions…). Elles ne créent pas de
   *  ligne dans le tableau des dépenses ; ce total rend l'écart vérifiable :
   *  Σ postes.recettesCents + recettesHorsPosteCents = recettesEncaissées. */
  recettesHorsPosteCents: number;
}

const keyOf = (c: CatAmount) => c.categoryId ?? '__none__';
const nameOf = (c: CatAmount) => c.categoryName ?? '(non catégorisé)';

export function buildCampBudgetRows(agg: CampAgg): CampBudgetRows {
  const postes = new Map<string, CampPoste>();
  const ensure = (c: CatAmount): CampPoste => {
    const k = keyOf(c);
    let p = postes.get(k);
    if (!p) {
      p = { categoryId: c.categoryId, categoryName: nameOf(c), budgetCents: 0, ecrituresCents: 0, depotsCents: 0, depenseCents: 0, recettesCents: 0, netCents: 0 };
      postes.set(k, p);
    }
    return p;
  };
  for (const c of agg.budgetDepenses) ensure(c).budgetCents += c.amountCents;
  for (const c of agg.ecrituresDepenses) ensure(c).ecrituresCents += c.amountCents;
  for (const c of agg.depotsEnAttente) ensure(c).depotsCents += c.amountCents;

  // Les recettes ne CRÉENT pas de poste : sinon les participations des
  // familles apparaîtraient comme des lignes du tableau des dépenses.
  // Elles n'annotent que les postes déjà là — le cas qui compte étant la
  // dépense remboursée sur sa propre catégorie (caution de camion payée
  // puis rendue : le poste affichait le brut, sans trace du retour).
  let recettesHorsPoste = 0;
  for (const c of agg.recettesParCategorie) {
    const p = postes.get(keyOf(c));
    if (p) p.recettesCents += c.amountCents;
    else recettesHorsPoste += c.amountCents;
  }

  for (const p of postes.values()) {
    p.depenseCents = p.ecrituresCents + p.depotsCents;
    p.netCents = p.depenseCents - p.recettesCents;
  }

  const rows = Array.from(postes.values()).sort(
    (a, b) => b.budgetCents - a.budgetCents || b.depenseCents - a.depenseCents,
  );
  return {
    postes: rows,
    totalBudgetDepensesCents: rows.reduce((s, p) => s + p.budgetCents, 0),
    totalDepenseCents: rows.reduce((s, p) => s + p.depenseCents, 0),
    totalNetCents: rows.reduce((s, p) => s + p.netCents, 0),
    totalBudgetRecettesCents: agg.budgetRecettes.reduce((s, c) => s + c.amountCents, 0),
    recettesEncaisseesCents: agg.recettesEncaissees,
    recettesHorsPosteCents: recettesHorsPoste,
  };
}
