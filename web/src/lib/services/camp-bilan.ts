import { getDb, type DbWrapper } from '../db';
import { currentExercice, CATEGORIES_HORS_RESULTAT } from './overview';
import { ensureDepotsSchema } from './depots';
import { buildCampBudgetRows, type CampBudgetRows, type CatAmount } from './camp-budget';
import { getCamp, ensureCampsSchema, type Camp, type CampContext } from './camps';
import { listAvancesForCamp, type AvanceCamp } from './camp-avances';
import type { AvancesSummary } from './camp-avances-logic';
import {
  aggregerDepensesParCategorie,
  aggregerRecettesParCategorie,
  buildBilanResultat,
  classerJustifs,
  type BilanEcriture,
  type BilanJustifs,
  type BilanResultat,
} from './camp-bilan-logic';

// Bilan de fin de camp (spec 2026-09-06) : la photo complète d'un camp —
// résultat, toutes les écritures, ce qui n'a pas de pièce, et les tickets
// déposés qui ne sont rattachés à rien. Vue calculée, aucune entité.

const EXCLUS = CATEGORIES_HORS_RESULTAT.map(() => '?').join(',');

// `has_justificatif` ignore les pièces marquées obsolètes (obsolete_at) :
// une écriture dont le seul justif a été retiré est bien sans pièce.
const BILAN_ECR_SELECT = `
  SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type, e.justif_attendu,
         e.category_id, c.name AS category_name,
         EXISTS(SELECT 1 FROM justificatifs j
                WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
                  AND j.obsolete_at IS NULL) AS has_justificatif,
         (SELECT r.id FROM remboursements r WHERE r.ecriture_id = e.id LIMIT 1) AS remboursement_id
  FROM ecritures e LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id = ?
    AND (e.category_id IS NULL OR e.category_id NOT IN (${EXCLUS}))
  ORDER BY e.date_ecriture DESC, e.id DESC`;

export async function selectCampEcritures(
  db: DbWrapper,
  groupId: string,
  activiteId: string,
  uniteId: string,
): Promise<BilanEcriture[]> {
  return db
    .prepare(BILAN_ECR_SELECT)
    .all<BilanEcriture>(groupId, activiteId, uniteId, ...CATEGORIES_HORS_RESULTAT);
}

export interface DepotOrphelin {
  id: string;
  titre: string;
  amount_cents: number | null;
  date_estimee: string | null;
  statut: string;
  motif_rejet: string | null;
  category_name: string | null;
  submitter_name: string | null;
  created_at: string;
}

/** Tickets déposés sur le camp jamais rattachés à une écriture. */
export async function selectDepotsOrphelins(
  db: DbWrapper,
  groupId: string,
  activiteId: string,
  uniteId: string,
): Promise<DepotOrphelin[]> {
  return db
    .prepare(
      `SELECT d.id, d.titre, d.amount_cents, d.date_estimee, d.statut, d.motif_rejet,
              d.created_at, c.name AS category_name, u.nom_affichage AS submitter_name
       FROM depots_justificatifs d
       LEFT JOIN categories c ON c.id = d.category_id
       LEFT JOIN users u ON u.id = d.submitted_by_user_id
       WHERE d.group_id = ? AND d.activite_id = ? AND d.unite_id = ?
         AND d.statut IN ('a_traiter', 'rejete')
       ORDER BY d.created_at DESC, d.id DESC`,
    )
    .all<DepotOrphelin>(groupId, activiteId, uniteId);
}

/**
 * Dépôts en attente du groupe sans activité ou sans branche/pôle : ils
 * n'apparaissent dans AUCUN camp (camp = activité × unité) — signalement
 * anti-trou, symétrique de `sansUniteCount` sur les écritures.
 */
export async function countDepotsSansImputation(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM depots_justificatifs d
       WHERE d.group_id = ? AND d.statut = 'a_traiter'
         AND (d.activite_id IS NULL OR d.unite_id IS NULL)`,
    )
    .get<{ n: number }>(groupId);
  return row?.n ?? 0;
}

export interface CampBilan {
  camp: Camp;
  resultat: BilanResultat;
  ecritures: BilanEcriture[];
  justifs: BilanJustifs;
  depotsOrphelins: DepotOrphelin[];
  depotsSansImputationCount: number;
  /** Écritures de l'activité sans branche/pôle : invisibles de tout camp. */
  sansUniteCount: number;
  avancesEnCirculation: AvanceCamp[];
  avancesSummary: AvancesSummary | null;
  /** Budget vs réalisé par poste, réutilisé du dashboard camp. */
  rows: CampBudgetRows;
}

export async function getCampBilan(ctx: CampContext, id: string): Promise<CampBilan | null> {
  await ensureCampsSchema();
  await ensureDepotsSchema();
  const camp = await getCamp(ctx, id);
  if (!camp) return null;
  const db = getDb();
  const { groupId } = ctx;
  const { activite_id: act, unite_id: uni } = camp;

  const [ecritures, depotsOrphelins, depotsSansImputationCount, avancesData] = await Promise.all([
    selectCampEcritures(db, groupId, act, uni),
    selectDepotsOrphelins(db, groupId, act, uni),
    countDepotsSansImputation(db, groupId),
    listAvancesForCamp(ctx, id),
  ]);

  const budget = await db
    .prepare(
      `SELECT bl.category_id AS categoryId, c.name AS categoryName, bl.type, SUM(bl.amount_cents) AS amountCents
       FROM budget_lignes bl
       JOIN budgets b ON b.id = bl.budget_id
       LEFT JOIN categories c ON c.id = bl.category_id
       WHERE b.group_id = ? AND b.saison = ? AND bl.activite_id = ? AND bl.unite_id = ?
       GROUP BY bl.category_id, bl.type`,
    )
    .all<CatAmount & { type: 'depense' | 'recette' }>(groupId, currentExercice(), act, uni);

  const depotsParCategorie = await db
    .prepare(
      `SELECT d.category_id AS categoryId, c.name AS categoryName, SUM(COALESCE(d.amount_cents, 0)) AS amountCents
       FROM depots_justificatifs d LEFT JOIN categories c ON c.id = d.category_id
       WHERE d.group_id = ? AND d.activite_id = ? AND d.unite_id = ? AND d.statut = 'a_traiter'
       GROUP BY d.category_id`,
    )
    .all<CatAmount>(groupId, act, uni);

  const sansUnite = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ecritures e
       WHERE e.group_id = ? AND e.activite_id = ? AND e.unite_id IS NULL`,
    )
    .get<{ n: number }>(groupId, act);

  // Le résultat ne compte que les tickets encore en attente (les rejetés
  // ne deviendront jamais une dépense).
  const depotsEnAttenteCents = depotsOrphelins
    .filter((d) => d.statut === 'a_traiter')
    .reduce((s, d) => s + (d.amount_cents ?? 0), 0);

  const resultat = buildBilanResultat(ecritures, depotsEnAttenteCents);

  const rows = buildCampBudgetRows({
    budgetDepenses: budget.filter((b) => b.type === 'depense'),
    budgetRecettes: budget.filter((b) => b.type === 'recette'),
    ecrituresDepenses: aggregerDepensesParCategorie(ecritures),
    depotsEnAttente: depotsParCategorie,
    recettesParCategorie: aggregerRecettesParCategorie(ecritures),
    recettesEncaissees: resultat.recettesCents,
  });

  return {
    camp,
    resultat,
    ecritures,
    justifs: classerJustifs(ecritures),
    depotsOrphelins,
    depotsSansImputationCount,
    sansUniteCount: sansUnite?.n ?? 0,
    avancesEnCirculation: (avancesData?.avances ?? []).filter((a) => a.statut !== 'cloturee'),
    avancesSummary: avancesData?.summary ?? null,
    rows,
  };
}
