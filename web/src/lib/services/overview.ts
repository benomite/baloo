import { getDb } from '../db';
import { formatAmount } from '../format';

export interface OverviewContext {
  groupId: string;
}

// Filtre exercice SGDF : Sept N → Août N+1.
// Permet de comparer Baloo au compte de résultat Comptaweb (qui agrège
// par exercice). Si null, agrège tout.
export interface OverviewFilters {
  exercice?: string | null; // 'YYYY-YYYY+1' ex: '2025-2026'
}

export function exerciceBounds(exercice: string): { start: string; end: string } {
  const m = exercice.match(/^(\d{4})-(\d{4})$/);
  if (!m) throw new Error(`Exercice invalide : ${exercice}`);
  const y = parseInt(m[1], 10);
  return { start: `${y}-09-01`, end: `${y + 1}-08-31` };
}

export function currentExercice(now: Date = new Date()): string {
  // Si on est entre janvier et août : exercice = (year-1)-year
  // Si on est entre sept et décembre : exercice = year-(year+1)
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export interface CategorieRow {
  category_id: string | null;
  category_name: string;
  comptaweb_id: number | null;
  depenses: number;
  recettes: number;
  budget_prevu_depenses: number;
  budget_prevu_recettes: number;
}

export interface ParActiviteRow {
  activite_id: string | null;
  activite_name: string | null;
  reel_depenses: number;
  reel_recettes: number;
  prevu_depenses: number;
  prevu_recettes: number;
}

export interface EcritureLite {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  category_name: string | null;
  numero_piece: string | null;
}

export interface UniteOverviewData {
  unite: {
    id: string;
    code: string;
    name: string;
    couleur: string | null;
    branche: string | null;
  };
  exerciceFiltre: string | null;
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  parCategorie: CategorieRow[];
  parActivite: ParActiviteRow[];
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
  ecrituresRecentes: EcritureLite[];
  totalEcritures: number;
}

export interface OverviewData {
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  totalDepensesFormatted: string;
  totalRecettesFormatted: string;
  soldeFormatted: string;
  parUnite: { id: string; code: string; name: string; couleur: string | null; depenses: number; recettes: number; solde: number; budget_prevu_depenses: number }[];
  parCategorie: CategorieRow[];
  remboursementsEnAttente: { count: number; total: number; totalFormatted: string };
  alertes: {
    depensesSansJustificatif: number;
    nonSyncComptaweb: number;
    ecrituresSansUnite: number;
    remboursementsSansUnite: number;
    caisseSansUnite: number;
  };
  dernierImport: { date: string; fichier: string } | null;
  exerciceFiltre: string | null;
}

export async function getOverview(
  { groupId }: OverviewContext,
  filters: OverviewFilters = {},
): Promise<OverviewData> {
  const db = getDb();

  // Construction des bornes date pour le filtre exercice.
  let dateClause = '';
  const dateValues: unknown[] = [];
  if (filters.exercice) {
    const { start, end } = exerciceBounds(filters.exercice);
    dateClause = ' AND e.date_ecriture >= ? AND e.date_ecriture <= ?';
    dateValues.push(start, end);
  }

  const dep = await db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures e
     WHERE e.group_id = ? AND e.type = 'depense'${dateClause}`,
  ).get<{ total: number }>(groupId, ...dateValues);

  const rec = await db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures e
     WHERE e.group_id = ? AND e.type = 'recette'${dateClause}`,
  ).get<{ total: number }>(groupId, ...dateValues);

  const saison = filters.exercice ?? currentExercice();

  const parUniteRows = await db.prepare(`
    SELECT u.id, u.code, u.name, u.couleur,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes,
      COALESCE((
        SELECT SUM(bl.amount_cents) FROM budget_lignes bl
        JOIN budgets b ON b.id = bl.budget_id
        WHERE b.group_id = ? AND b.saison = ?
          AND bl.unite_id = u.id AND bl.type = 'depense'
      ), 0) as budget_prevu_depenses
    FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?${dateClause}
    WHERE u.group_id = ?
    GROUP BY u.id ORDER BY u.code
  `).all<{ id: string; code: string; name: string; couleur: string | null; depenses: number; recettes: number; budget_prevu_depenses: number }>(groupId, saison, groupId, ...dateValues, groupId);

  // Breakdown par catégorie SGDF — comparable ligne à ligne au compte de
  // résultat Comptaweb (qui agrège par "Nature" = catégorie). Les
  // écritures sans catégorie sont regroupées sous "(non catégorisé)".
  const parCategorie = await db.prepare(`
    SELECT
      c.id as category_id,
      COALESCE(c.name, '(non catégorisé)') as category_name,
      c.comptaweb_id,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
    FROM ecritures e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ?${dateClause}
    GROUP BY c.id
    ORDER BY (depenses + recettes) DESC
  `).all<CategorieRow>(groupId, ...dateValues);

  const rbt = await db.prepare(
    "SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total FROM remboursements WHERE group_id = ? AND status IN ('demande', 'valide')"
  ).get<{ count: number; total: number }>(groupId);

  const sansJustif = await db.prepare(`
    SELECT COUNT(*) as count FROM ecritures e
    WHERE e.group_id = ? AND e.type = 'depense' AND e.justif_attendu = 1
    AND NOT EXISTS (SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
  `).get<{ count: number }>(groupId);

  const nonSync = await db.prepare(
    "SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND comptaweb_synced = 0 AND status != 'brouillon'"
  ).get<{ count: number }>(groupId);

  const lastImport = await db.prepare(
    'SELECT import_date as date, source_file as fichier FROM comptaweb_imports WHERE group_id = ? ORDER BY import_date DESC LIMIT 1'
  ).get<{ date: string; fichier: string }>(groupId);

  // Audit couverture unite_id : compte les opérations qui n'ont pas
  // d'unité rattachée (tous statuts confondus, hors archived/refuse).
  // Pré-requis pour piloter des budgets par unité.
  const sansUniteEcr = await db.prepare(
    "SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND unite_id IS NULL",
  ).get<{ count: number }>(groupId);

  const sansUniteRbt = await db.prepare(
    "SELECT COUNT(*) as count FROM remboursements WHERE group_id = ? AND unite_id IS NULL AND status != 'refuse'",
  ).get<{ count: number }>(groupId);

  const sansUniteCaisse = await db.prepare(
    "SELECT COUNT(*) as count FROM mouvements_caisse WHERE group_id = ? AND unite_id IS NULL AND archived_at IS NULL",
  ).get<{ count: number }>(groupId);

  const totDep = dep?.total ?? 0;
  const totRec = rec?.total ?? 0;

  return {
    totalDepenses: totDep,
    totalRecettes: totRec,
    solde: totRec - totDep,
    totalDepensesFormatted: formatAmount(totDep),
    totalRecettesFormatted: formatAmount(totRec),
    soldeFormatted: formatAmount(totRec - totDep),
    parUnite: parUniteRows.map(u => ({ ...u, solde: u.recettes - u.depenses })),
    parCategorie,
    remboursementsEnAttente: { count: rbt?.count ?? 0, total: rbt?.total ?? 0, totalFormatted: formatAmount(rbt?.total ?? 0) },
    alertes: {
      depensesSansJustificatif: sansJustif?.count ?? 0,
      nonSyncComptaweb: nonSync?.count ?? 0,
      ecrituresSansUnite: sansUniteEcr?.count ?? 0,
      remboursementsSansUnite: sansUniteRbt?.count ?? 0,
      caisseSansUnite: sansUniteCaisse?.count ?? 0,
    },
    dernierImport: lastImport ?? null,
    exerciceFiltre: filters.exercice ?? null,
  };
}

export interface UniteOverviewArgs {
  uniteId: string;
}

// Renvoie null si l'unité n'appartient pas au group (anti-énumération
// inter-groupes — la page render un 404 indistinguable de "n'existe pas").
export async function getUniteOverview(
  { groupId }: OverviewContext,
  args: UniteOverviewArgs,
  filters: OverviewFilters = {},
): Promise<UniteOverviewData | null> {
  const db = getDb();

  const unite = await db.prepare(
    'SELECT id, code, name, couleur, branche FROM unites WHERE id = ? AND group_id = ?',
  ).get<{ id: string; code: string; name: string; couleur: string | null; branche: string | null }>(
    args.uniteId,
    groupId,
  );
  if (!unite) return null;

  let dateClause = '';
  const dateValues: unknown[] = [];
  if (filters.exercice) {
    const { start, end } = exerciceBounds(filters.exercice);
    dateClause = ' AND e.date_ecriture >= ? AND e.date_ecriture <= ?';
    dateValues.push(start, end);
  }

  const totaux = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'depense' THEN amount_cents ELSE 0 END), 0) as dep,
       COALESCE(SUM(CASE WHEN type = 'recette' THEN amount_cents ELSE 0 END), 0) as rec
     FROM ecritures e
     WHERE e.group_id = ? AND e.unite_id = ?${dateClause}`,
  ).get<{ dep: number; rec: number }>(groupId, args.uniteId, ...dateValues);

  const saison = filters.exercice ?? currentExercice();

  const parCategorie = await db.prepare(`
    SELECT
      c.id as category_id,
      COALESCE(c.name, '(non catégorisé)') as category_name,
      c.comptaweb_id,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes,
      COALESCE((
        SELECT SUM(bl.amount_cents) FROM budget_lignes bl
        JOIN budgets b ON b.id = bl.budget_id
        WHERE b.group_id = ? AND b.saison = ?
          AND bl.unite_id = ? AND bl.type = 'depense'
          AND ((bl.category_id IS NULL AND c.id IS NULL) OR bl.category_id = c.id)
      ), 0) as budget_prevu_depenses,
      COALESCE((
        SELECT SUM(bl.amount_cents) FROM budget_lignes bl
        JOIN budgets b ON b.id = bl.budget_id
        WHERE b.group_id = ? AND b.saison = ?
          AND bl.unite_id = ? AND bl.type = 'recette'
          AND ((bl.category_id IS NULL AND c.id IS NULL) OR bl.category_id = c.id)
      ), 0) as budget_prevu_recettes
    FROM ecritures e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
    GROUP BY c.id
    ORDER BY (depenses + recettes) DESC
  `).all<CategorieRow>(
    groupId, saison, args.uniteId,
    groupId, saison, args.uniteId,
    groupId, args.uniteId, ...dateValues,
  );

  const parActivite = await db.prepare(`
    WITH reel AS (
      SELECT e.activite_id,
             SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END) as reel_depenses,
             SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END) as reel_recettes
      FROM ecritures e
      WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
      GROUP BY e.activite_id
    ),
    prevu AS (
      SELECT bl.activite_id,
             SUM(CASE WHEN bl.type = 'depense' THEN bl.amount_cents ELSE 0 END) as prevu_depenses,
             SUM(CASE WHEN bl.type = 'recette' THEN bl.amount_cents ELSE 0 END) as prevu_recettes
      FROM budget_lignes bl
      JOIN budgets b ON b.id = bl.budget_id
      WHERE b.group_id = ? AND b.saison = ? AND bl.unite_id = ?
      GROUP BY bl.activite_id
    ),
    union_ids AS (
      SELECT activite_id FROM reel
      UNION
      SELECT activite_id FROM prevu
    )
    SELECT u.activite_id, a.name as activite_name,
           COALESCE(r.reel_depenses, 0) as reel_depenses,
           COALESCE(r.reel_recettes, 0) as reel_recettes,
           COALESCE(p.prevu_depenses, 0) as prevu_depenses,
           COALESCE(p.prevu_recettes, 0) as prevu_recettes
    FROM union_ids u
    LEFT JOIN activites a ON a.id = u.activite_id
    LEFT JOIN reel r ON r.activite_id IS u.activite_id
    LEFT JOIN prevu p ON p.activite_id IS u.activite_id
  `).all<ParActiviteRow>(
    groupId, args.uniteId, ...dateValues,
    groupId, saison, args.uniteId,
  );

  // Tri en JS (NULLS LAST pas garanti côté SQL libsql) : prévu décroissant
  // puis réel décroissant.
  parActivite.sort((a, b) => {
    if (b.prevu_depenses !== a.prevu_depenses) return b.prevu_depenses - a.prevu_depenses;
    return b.reel_depenses - a.reel_depenses;
  });

  const sansJustif = await db.prepare(`
    SELECT COUNT(*) as count FROM ecritures e
    WHERE e.group_id = ? AND e.unite_id = ? AND e.type = 'depense' AND e.justif_attendu = 1${dateClause}
    AND NOT EXISTS (SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
  `).get<{ count: number }>(groupId, args.uniteId, ...dateValues);

  const nonSync = await db.prepare(
    `SELECT COUNT(*) as count FROM ecritures e WHERE e.group_id = ? AND e.unite_id = ? AND e.comptaweb_synced = 0 AND e.status != 'brouillon'${dateClause}`,
  ).get<{ count: number }>(groupId, args.uniteId, ...dateValues);

  const ecrituresRecentes = await db.prepare(`
    SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type,
           e.numero_piece, c.name as category_name
    FROM ecritures e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.group_id = ? AND e.unite_id = ?${dateClause}
    ORDER BY e.date_ecriture DESC, e.id DESC
    LIMIT 50
  `).all<EcritureLite>(groupId, args.uniteId, ...dateValues);

  const totalEcrRow = await db.prepare(
    `SELECT COUNT(*) as count FROM ecritures e WHERE e.group_id = ? AND e.unite_id = ?${dateClause}`,
  ).get<{ count: number }>(groupId, args.uniteId, ...dateValues);

  const dep = totaux?.dep ?? 0;
  const rec = totaux?.rec ?? 0;

  return {
    unite,
    exerciceFiltre: filters.exercice ?? null,
    totalDepenses: dep,
    totalRecettes: rec,
    solde: rec - dep,
    parCategorie,
    parActivite,
    alertes: {
      depensesSansJustificatif: sansJustif?.count ?? 0,
      nonSyncComptaweb: nonSync?.count ?? 0,
    },
    ecrituresRecentes,
    totalEcritures: totalEcrRow?.count ?? 0,
  };
}
