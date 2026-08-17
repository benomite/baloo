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
// On supprime les drafts au sous_index devenu invalide, sous garde-fous :
// statut 'draft', non reliés à Comptaweb, sans pièce attachée (justif, dépôt,
// remboursement — jamais détruite, cf. deleteDraftEcriture). L'imputation du
// trésorier est préservée pour un draft de SOUS-LIGNE obsolète (re-ventilation
// DSP2 — potentiellement un vrai travail). En revanche un draft « ligne
// entière » (sous_index null) supplanté par des sous-lignes est retiré MÊME
// imputé : son grain agrégé est définitivement invalide (montant = somme des
// sous-lignes → doublon), donc son imputation ne peut être que provisoire ou
// erronée. Sinon le doublon reste indélogeable automatiquement.

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
    if (d.hasAttachment) continue; // pièce attachée → garder (FK, cf. deleteDraftEcriture)
    // Draft de SOUS-LIGNE devenu stale (re-ventilation DSP2) : l'imputation peut
    // être un vrai travail du trésorier → on la préserve. Mais un draft « ligne
    // entière » (sous_index null) supplanté par des sous-lignes a un grain agrégé
    // DÉFINITIVEMENT invalide (son montant = somme des sous-lignes → doublon) :
    // l'imputation dessus ne peut être que provisoire/erronée, on le retire même
    // imputé (sinon doublon indélogeable — bug terrain 2026-07-03, ligne mise en
    // SG puis détail DSP2 apparu).
    if (d.hasImputation && d.sousLigneIndex !== null) continue;
    out.push(d.id);
  }
  return out;
}

export interface LineHealPlan {
  /** Drafts stale à supprimer (cf. `planStaleLineDrafts`), plus le jumeau nu supplanté par une promotion. */
  toDelete: string[];
  /** Agrégat porteur de pièces qui prend l'identité de la sous-ligne (heal en place, aucune donnée perdue). */
  toPromote: Array<{ id: string; sousLigneIndex: number }>;
  /** Agrégats supplantés qu'on ne sait pas healer tout seul : à signaler au trésorier. */
  toFlag: string[];
}

const estNu = (d: ExistingLineDraft): boolean =>
  d.status === 'draft' && d.comptawebEcritureId === null && !d.hasAttachment && !d.hasImputation;

/**
 * Étend `planStaleLineDrafts` au cas « agrégat DÉJÀ justifié ».
 *
 * `planStaleLineDrafts` épargne (à raison) un draft « ligne entière » qui porte
 * une pièce — mais il le laisse alors en doublon du détail DSP2, silencieusement
 * et pour toujours : `dedup-ecritures` ne peut pas le voir non plus (il groupe
 * par description + catégorie, or l'agrégat est enrichi et le détail est brut ;
 * et dès N>1 les montants diffèrent). Cas terrain 2026-08-17 : ECR-2026-472
 * (agrégat imputé + 2 justifs + 1 dépôt) et ECR-2026-524 (sous-ligne nue) sur la
 * même ligne bancaire 19130340.
 *
 * Quand le détail ne compte qu'UNE sous-ligne, l'identité est non ambiguë :
 * l'agrégat est **promu** à ce sous-index plutôt que supprimé — il garde ses
 * justifs, son dépôt rattaché et son imputation (rien à re-saisir, aucune FK
 * cassée), et le jumeau nu créé entre-temps disparaît. C'est le même principe
 * que le self-heal du `type` : on corrige en place, jamais delete+recreate.
 *
 * Dès que c'est ambigu (plusieurs sous-lignes → le grain agrégé doit être
 * reventilé à la main ; plusieurs agrégats candidats ; jumeau déjà travaillé),
 * on ne devine pas : l'agrégat est signalé pour arbitrage humain.
 */
export function planLineHeal(
  canonicalSousIndexes: Array<number | null>,
  existing: ExistingLineDraft[],
): LineHealPlan {
  const toDelete = planStaleLineDrafts(canonicalSousIndexes, existing);
  const canonical = new Set(canonicalSousIndexes.map(key));

  // Agrégats supplantés que `planStaleLineDrafts` a épargnés pour leur pièce.
  const bloques = existing.filter(
    (d) =>
      d.sousLigneIndex === null &&
      !canonical.has(key(null)) &&
      d.status === 'draft' &&
      d.comptawebEcritureId === null &&
      d.hasAttachment,
  );
  if (bloques.length === 0) return { toDelete, toPromote: [], toFlag: [] };

  const cibles = canonicalSousIndexes.filter((i): i is number => i !== null);
  const abandon = (): LineHealPlan => ({ toDelete, toPromote: [], toFlag: bloques.map((d) => d.id) });

  // Promotion seulement si l'appariement est forcé : un agrégat, une sous-ligne.
  if (bloques.length !== 1 || cibles.length !== 1) return abandon();

  const cible = cibles[0];
  const jumeau = existing.find((d) => d.sousLigneIndex === cible);
  if (jumeau && !estNu(jumeau)) return abandon();

  return {
    toDelete: jumeau ? [...toDelete, jumeau.id] : toDelete,
    toPromote: [{ id: bloques[0].id, sousLigneIndex: cible }],
    toFlag: [],
  };
}
