// Cœur PUR de la réconciliation Comptaweb (spec 2026-06-01).
//
// `reconcile(snapshot, baloo, opts)` décide — sans BDD ni HTTP — ce que
// le cycle doit faire pour aligner Baloo sur Comptaweb (source de vérité) :
//   - updates    : écritures déjà reliées (clé stable comptaweb_ecriture_id)
//                  → CW écrase les champs comptables (needsDetail si la
//                    signature liste a changé → relire la page détail).
//   - promotions : drafts locaux reliés à une ligne CW par match contenu
//                  CONFIANT (montant+type+date±tol, unique des deux côtés).
//   - deletions  : écritures reliées, dans la plage couverte, absentes du
//                  snapshot → supprimee_cw.
//   - imports    : lignes CW jamais matchées → créer en mirror.
//   - suggestions: matches contenu AMBIGUS → lien à confirmer (pas d'auto).
//
// La séparation pur/orchestration permet de tester toute la logique de
// décision sur des données en mémoire (cf. ecritures-sync-reconcile.test.ts).

export type EcritureType = 'depense' | 'recette';

/** Une ligne de la liste CW scrapée, enrichie de sa signature. */
export interface CwSnapshotRow {
  cwId: number;
  numeroPiece: string;
  date: string; // ISO YYYY-MM-DD
  type: EcritureType;
  montantCents: number;
  intitule: string;
  modeTransaction: string;
  categorieTiers: string;
  /** hash stable des champs liste — comparé à ecritures.cw_signature. */
  signature: string;
}

/** Une écriture Baloo candidate à la réconciliation. */
export interface BalooRow {
  id: string;
  status: string;
  comptawebEcritureId: number | null;
  amountCents: number;
  type: EcritureType;
  dateEcriture: string; // ISO YYYY-MM-DD
  cwSignature: string | null;
  /**
   * Vrai si l'écriture a au moins une imputation posée (activité, unité ou
   * catégorie). Si false, on force la relecture du détail même à signature
   * inchangée — sinon une écriture jamais enrichie (ou enrichie par un
   * scraper cassé) resterait définitivement sans imputation.
   */
  hasImputation: boolean;
}

export interface ReconcilePlan {
  /** écriture déjà reliée présente dans CW → réaligner. */
  updates: { ecritureId: string; cw: CwSnapshotRow; needsDetail: boolean }[];
  /** draft promu en mirror (match contenu unique/confiant). */
  promotions: { ecritureId: string; cw: CwSnapshotRow }[];
  /** écriture reliée, dans la plage couverte, absente de CW → supprimee_cw. */
  deletions: string[];
  /** ligne CW jamais matchée → créer en mirror. */
  imports: CwSnapshotRow[];
  /** match contenu ambigu → suggestion de lien à confirmer. */
  suggestions: { ecritureId: string; cw: CwSnapshotRow }[];
}

export interface ReconcileOptions {
  /** tolérance en jours sur l'écart de date pour le match contenu des drafts. */
  dateToleranceDays: number;
}

/**
 * Signature stable des champs LISTE d'une écriture CW. Sert à décider de
 * l'enrichissement détail incrémental : si la signature stockée
 * (`ecritures.cw_signature`) diffère de celle recalculée, c'est que CW a
 * changé un champ visible → on relit la page détail. Doit être déterministe
 * et identique côté cycle (recalcul) et côté stockage (au moment de l'update).
 */
export function computeCwSignature(fields: {
  date: string;
  type: string;
  montantCents: number;
  intitule: string;
  numeroPiece: string;
  modeTransaction: string;
  categorieTiers: string;
}): string {
  return [
    fields.date,
    fields.type,
    String(fields.montantCents),
    fields.intitule,
    fields.numeroPiece,
    fields.modeTransaction,
    fields.categorieTiers,
  ].join('|');
}

// ============================================================================
// Réconciliation au grain VENTILATION (ADR-035, correctifs granularité)
// ============================================================================
//
// Une écriture CW porte N ventilations ; côté Baloo le grain est la
// ventilation (1 écriture Baloo = 1 ventilation). `reconcileVentilations`
// aligne les ventilations CW d'UNE écriture sur les écritures Baloo
// candidates (déjà reliées à ce cwId, + écritures non reliées matchées par
// contenu, ex. issues de l'import CSV).

export interface ResolvedVentilation {
  montantCents: number;
  categoryId: string | null;
  activiteId: string | null;
  uniteId: string | null;
}

export interface VentCandidate {
  id: string;
  amountCents: number;
  /** true si l'écriture est déjà reliée à CE cwId (comptaweb_ecriture_id == cwId). */
  linkedToThisCw: boolean;
}

export interface VentilationPlan {
  /** ventilation existante côté Baloo → mettre à jour (lier + imputation). */
  updates: { ecritureId: string; vent: ResolvedVentilation }[];
  /** ventilation sans équivalent Baloo → créer. */
  creates: ResolvedVentilation[];
  /** écriture reliée à ce cwId ne correspondant à AUCUNE ventilation
   *  (ex. agrégat erroné, ou ventilation supprimée dans CW) → supprimee_cw. */
  orphans: string[];
}

/**
 * Apparie les ventilations CW d'une écriture aux écritures Baloo candidates,
 * par montant (clé naturelle : au sein d'une écriture les ventilations ont
 * des montants généralement distincts). Une écriture non reliée non
 * appariée n'est PAS touchée (ce n'était pas une ventilation de ce cwId).
 */
export function reconcileVentilations(
  ventilations: ResolvedVentilation[],
  candidates: VentCandidate[],
): VentilationPlan {
  const plan: VentilationPlan = { updates: [], creates: [], orphans: [] };
  const consumed = new Set<string>();
  const unmatched: ResolvedVentilation[] = [];

  // Passe 1 — appariement par MONTANT (priorité à un candidat déjà relié à
  // ce cwId, pour ne pas re-piocher une écriture CSV non reliée si une
  // version reliée existe).
  for (const v of ventilations) {
    const free = candidates.filter((c) => !consumed.has(c.id) && c.amountCents === v.montantCents);
    const pick = free.find((c) => c.linkedToThisCw) ?? free[0];
    if (pick) {
      consumed.add(pick.id);
      plan.updates.push({ ecritureId: pick.id, vent: v });
    } else {
      unmatched.push(v);
    }
  }

  // Passe 2 — appariement AGNOSTIQUE au montant, uniquement entre les
  // ventilations restantes et les candidats déjà RELIÉS non consommés. Gère
  // un changement de montant côté CW (sinon : faux delete+create). On reste
  // prudent : on ne pioche pas d'écriture non reliée à l'aveugle.
  const freeLinked = candidates.filter((c) => c.linkedToThisCw && !consumed.has(c.id));
  for (const v of unmatched) {
    const pick = freeLinked.find((c) => !consumed.has(c.id));
    if (pick) {
      consumed.add(pick.id);
      plan.updates.push({ ecritureId: pick.id, vent: v });
    } else {
      plan.creates.push(v);
    }
  }

  // Candidats reliés à ce cwId mais non consommés = orphelins (agrégat, ou
  // ventilation disparue de CW). Les non-reliés non consommés sont ignorés.
  for (const c of candidates) {
    if (c.linkedToThisCw && !consumed.has(c.id)) plan.orphans.push(c.id);
  }

  return plan;
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

/**
 * Diff snapshot CW ↔ écritures Baloo. Voir en-tête de fichier pour la
 * sémantique de chaque sortie.
 *
 * `snapshot` = écritures CW de la fenêtre scrapée. La plage couverte est
 * dérivée de `[min(cwId), max(cwId)]` : une suppression n'est affirmée que
 * pour une écriture Baloo dont le `comptawebEcritureId` tombe DANS cette
 * plage (sinon = hors fenêtre, on n'y touche pas).
 */
export function reconcile(
  snapshot: CwSnapshotRow[],
  baloo: BalooRow[],
  opts: ReconcileOptions,
): ReconcilePlan {
  const plan: ReconcilePlan = {
    updates: [],
    promotions: [],
    deletions: [],
    imports: [],
    suggestions: [],
  };

  // Plage couverte par id stable.
  const ids = snapshot.map((r) => r.cwId);
  const hasRange = ids.length > 0;
  const minId = hasRange ? Math.min(...ids) : 0;
  const maxId = hasRange ? Math.max(...ids) : 0;

  const snapByCwId = new Map<number, CwSnapshotRow>();
  for (const row of snapshot) snapByCwId.set(row.cwId, row);

  // Lignes CW consommées par un match (stable ou promotion) → exclues de l'import.
  const consumedCwIds = new Set<number>();
  // cwIds impliqués dans une suggestion ambiguë → ni import ni promotion.
  const ambiguousCwIds = new Set<number>();

  // 1. Match par clé stable (mirror / pending_sync / divergent reliés).
  for (const row of baloo) {
    if (row.comptawebEcritureId == null) continue;
    const cw = snapByCwId.get(row.comptawebEcritureId);
    if (cw) {
      consumedCwIds.add(cw.cwId);
      plan.updates.push({
        ecritureId: row.id,
        cw,
        needsDetail: row.cwSignature !== cw.signature || !row.hasImputation,
      });
    } else if (hasRange && row.comptawebEcritureId >= minId && row.comptawebEcritureId <= maxId) {
      // Reliée, dans la plage couverte, absente → vraie suppression.
      plan.deletions.push(row.id);
    }
    // Sinon (hors plage) : intouchée.
  }

  // 2. Match contenu des drafts (sans clé stable) contre les lignes CW
  //    encore libres. Garde-fou unicité : on ne promeut que si exactement
  //    une paire (1 draft ↔ 1 cw) correspond au critère.
  const drafts = baloo.filter((r) => r.status === 'draft' && r.comptawebEcritureId == null);
  const freeCw = snapshot.filter((c) => !consumedCwIds.has(c.cwId));

  const matchesCriteria = (d: BalooRow, c: CwSnapshotRow): boolean =>
    d.amountCents === c.montantCents &&
    d.type === c.type &&
    daysBetween(d.dateEcriture, c.date) <= opts.dateToleranceDays;

  for (const d of drafts) {
    const cwCandidates = freeCw.filter((c) => matchesCriteria(d, c) && !ambiguousCwIds.has(c.cwId));
    if (cwCandidates.length === 0) continue;
    if (cwCandidates.length > 1) {
      // Draft ambigu côté CW.
      for (const c of cwCandidates) {
        plan.suggestions.push({ ecritureId: d.id, cw: c });
        ambiguousCwIds.add(c.cwId);
      }
      continue;
    }
    const c = cwCandidates[0];
    // Vérifie l'unicité de l'autre côté : combien de drafts visent cette ligne CW ?
    const draftsForC = drafts.filter((dd) => matchesCriteria(dd, c));
    if (draftsForC.length > 1) {
      // Plusieurs drafts pour une même ligne CW → ambigu.
      for (const dd of draftsForC) plan.suggestions.push({ ecritureId: dd.id, cw: c });
      ambiguousCwIds.add(c.cwId);
      continue;
    }
    // 1 ↔ 1 : promotion confiante.
    plan.promotions.push({ ecritureId: d.id, cw: c });
    consumedCwIds.add(c.cwId);
  }

  // 3. Import : lignes CW jamais matchées (ni stable, ni promotion, ni
  //    suggestion ambiguë).
  for (const c of snapshot) {
    if (consumedCwIds.has(c.cwId)) continue;
    if (ambiguousCwIds.has(c.cwId)) continue;
    plan.imports.push(c);
  }

  return plan;
}
