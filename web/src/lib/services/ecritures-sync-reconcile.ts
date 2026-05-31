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
        needsDetail: row.cwSignature !== cw.signature,
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
