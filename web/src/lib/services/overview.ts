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
}

export interface OverviewData {
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  totalDepensesFormatted: string;
  totalRecettesFormatted: string;
  soldeFormatted: string;
  parUnite: { code: string; name: string; couleur: string | null; depenses: number; recettes: number; solde: number }[];
  parCategorie: CategorieRow[];
  remboursementsEnAttente: { count: number; total: number; totalFormatted: string };
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
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

  const parUnite = await db.prepare(`
    SELECT u.code, u.name, u.couleur,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
    FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?${dateClause}
    WHERE u.group_id = ?
    GROUP BY u.id ORDER BY u.code
  `).all<{ code: string; name: string; couleur: string | null; depenses: number; recettes: number }>(groupId, ...dateValues, groupId);

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

  const totDep = dep?.total ?? 0;
  const totRec = rec?.total ?? 0;

  return {
    totalDepenses: totDep,
    totalRecettes: totRec,
    solde: totRec - totDep,
    totalDepensesFormatted: formatAmount(totDep),
    totalRecettesFormatted: formatAmount(totRec),
    soldeFormatted: formatAmount(totRec - totDep),
    parUnite: parUnite.map(u => ({ ...u, solde: u.recettes - u.depenses })),
    parCategorie,
    remboursementsEnAttente: { count: rbt?.count ?? 0, total: rbt?.total ?? 0, totalFormatted: formatAmount(rbt?.total ?? 0) },
    alertes: { depensesSansJustificatif: sansJustif?.count ?? 0, nonSyncComptaweb: nonSync?.count ?? 0 },
    dernierImport: lastImport ?? null,
    exerciceFiltre: filters.exercice ?? null,
  };
}
