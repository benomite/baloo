// Réconciliation des drafts d'UNE ligne bancaire (pur, testable sans BDD).
//
// Invariant : une ligne bancaire doit avoir SOIT un draft « ligne entière »
// (sous_index null, quand la ligne n'a pas de sous-lignes DSP2), SOIT un draft
// par sous-ligne (sous_index 0..n-1), JAMAIS les deux. La ventilation DSP2
// d'une ligne « PAIEMENT C. PROC » apparaît parfois APRÈS le premier scrape :
// un draft « ligne entière » est alors déjà créé, puis les drafts par
// sous-ligne s'ajoutent au scrape suivant (clé d'existence = (ligne,
// sous_index), donc pas de collision). Le draft « ligne entière » survit alors
// en doublon : son montant = la somme des sous-lignes → double comptage.
//
// On supprime les drafts au sous_index devenu invalide — mais UNIQUEMENT s'ils
// sont restés des brouillons NUS (jamais touchés) : statut 'draft', non reliés
// à Comptaweb, sans imputation ni pièce attachée. Tout draft enrichi par le
// trésorier (imputation, justif, dépôt, remboursement) est préservé : on ne
// détruit jamais son travail, quitte à laisser un doublon visible qu'il
// retirera à la main.

export interface ExistingLineDraft {
  id: string;
  sousLigneIndex: number | null;
  status: string;
  comptawebEcritureId: number | null;
  hasImputation: boolean;
  hasAttachment: boolean;
}

const key = (i: number | null): string => (i === null ? 'L' : `S${i}`);

/**
 * Rend les ids des drafts de la ligne à supprimer : ceux dont le sous_index
 * n'est plus dans l'ensemble canonique courant ET qui sont des brouillons nus.
 */
export function planStaleLineDrafts(
  canonicalSousIndexes: Array<number | null>,
  existing: ExistingLineDraft[],
): string[] {
  const canonical = new Set(canonicalSousIndexes.map(key));
  const out: string[] = [];
  for (const d of existing) {
    if (canonical.has(key(d.sousLigneIndex))) continue; // toujours valide
    if (d.status !== 'draft') continue; // jamais toucher un non-draft
    if (d.comptawebEcritureId !== null) continue; // relié à CW → garder
    if (d.hasImputation) continue; // travail du trésorier → garder
    if (d.hasAttachment) continue; // pièce attachée → garder
    out.push(d.id);
  }
  return out;
}
