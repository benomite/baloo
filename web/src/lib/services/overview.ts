import { getDb } from '../db';
import { formatAmount } from '../format';

export interface OverviewContext {
  groupId: string;
}

export interface OverviewData {
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  totalDepensesFormatted: string;
  totalRecettesFormatted: string;
  soldeFormatted: string;
  parUnite: { code: string; name: string; couleur: string | null; depenses: number; recettes: number; solde: number }[];
  remboursementsEnAttente: { count: number; total: number; totalFormatted: string };
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
  dernierImport: { date: string; fichier: string } | null;
}

export async function getOverview({ groupId }: OverviewContext): Promise<OverviewData> {
  const db = getDb();

  const dep = await db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures WHERE group_id = ? AND type = 'depense'"
  ).get<{ total: number }>(groupId);

  const rec = await db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures WHERE group_id = ? AND type = 'recette'"
  ).get<{ total: number }>(groupId);

  const parUnite = await db.prepare(`
    SELECT u.code, u.name, u.couleur,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
    FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?
    WHERE u.group_id = ?
    GROUP BY u.id ORDER BY u.code
  `).all<{ code: string; name: string; couleur: string | null; depenses: number; recettes: number }>(groupId, groupId);

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
    remboursementsEnAttente: { count: rbt?.count ?? 0, total: rbt?.total ?? 0, totalFormatted: formatAmount(rbt?.total ?? 0) },
    alertes: { depensesSansJustificatif: sansJustif?.count ?? 0, nonSyncComptaweb: nonSync?.count ?? 0 },
    dernierImport: lastImport ?? null,
  };
}
