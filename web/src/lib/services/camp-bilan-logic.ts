// Bilan de fin de camp : calculs purs sur les écritures déjà filtrées par
// le service (activité × unité, hors CATEGORIES_HORS_RESULTAT).

export interface BilanEcriture {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  category_id: string | null;
  category_name: string | null;
  has_justificatif: number;
  remboursement_id: string | null;
  justif_attendu: number;
}

/** Poste de dépense réalisé, prêt à fusionner avec le budget du camp. */
export interface DepensePoste {
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
}

/**
 * Réel par poste, calculé depuis les écritures déjà chargées (pas de
 * requête d'agrégation en plus). La clé est `category_id` : c'est elle
 * que `buildCampBudgetRows` utilise pour rapprocher réel et budget.
 */
export function aggregerDepensesParCategorie(ecritures: BilanEcriture[]): DepensePoste[] {
  const parCat = new Map<string, DepensePoste>();
  for (const e of ecritures) {
    if (e.type !== 'depense') continue;
    const key = e.category_id ?? '__none__';
    const cur = parCat.get(key);
    if (cur) cur.amountCents += e.amount_cents;
    else parCat.set(key, { categoryId: e.category_id, categoryName: e.category_name, amountCents: e.amount_cents });
  }
  return [...parCat.values()];
}

export interface BilanResultat {
  recettesCents: number;
  depensesCents: number;
  resultatCents: number;
  // Tickets déposés pas encore rapprochés : dépense annoncée, pas encore
  // en banque. Hors résultat comptable, mais dans le projeté.
  depotsEnAttenteCents: number;
  resultatProjeteCents: number;
}

export function buildBilanResultat(
  ecritures: BilanEcriture[],
  depotsEnAttenteCents: number,
): BilanResultat {
  let recettesCents = 0;
  let depensesCents = 0;
  for (const e of ecritures) {
    if (e.type === 'recette') recettesCents += e.amount_cents;
    else depensesCents += e.amount_cents;
  }
  return {
    recettesCents,
    depensesCents,
    resultatCents: recettesCents - depensesCents,
    depotsEnAttenteCents,
    resultatProjeteCents: recettesCents - depensesCents - depotsEnAttenteCents,
  };
}

export interface BilanJustifs {
  /** Dépense sans pièce, pièce attendue : à récupérer. */
  manquants: BilanEcriture[];
  /** La pièce vit sur la demande de remboursement, pas sur l'écriture. */
  couvertsParRemboursement: BilanEcriture[];
  /** Marquées « justificatif non attendu » (frais bancaires, etc.). */
  nonAttendus: BilanEcriture[];
}

export function classerJustifs(ecritures: BilanEcriture[]): BilanJustifs {
  const out: BilanJustifs = { manquants: [], couvertsParRemboursement: [], nonAttendus: [] };
  for (const e of ecritures) {
    if (e.type !== 'depense' || e.has_justificatif) continue;
    if (e.remboursement_id) out.couvertsParRemboursement.push(e);
    else if (!e.justif_attendu) out.nonAttendus.push(e);
    else out.manquants.push(e);
  }
  return out;
}
