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
  parUnite: { code: string; name: string; depenses: number; recettes: number; solde: number }[];
  remboursementsEnAttente: { count: number; total: number; totalFormatted: string };
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
  dernierImport: { date: string; fichier: string } | null;
}

export function getOverview({ groupId }: OverviewContext): OverviewData {
  const db = getDb();

  const dep = db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures WHERE group_id = ? AND type = 'depense'"
  ).get(groupId) as { total: number };

  const rec = db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM ecritures WHERE group_id = ? AND type = 'recette'"
  ).get(groupId) as { total: number };

  const parUnite = db.prepare(`
    SELECT u.code, u.name,
      COALESCE(SUM(CASE WHEN e.type = 'depense' THEN e.amount_cents ELSE 0 END), 0) as depenses,
      COALESCE(SUM(CASE WHEN e.type = 'recette' THEN e.amount_cents ELSE 0 END), 0) as recettes
    FROM unites u LEFT JOIN ecritures e ON e.unite_id = u.id AND e.group_id = ?
    WHERE u.group_id = ?
    GROUP BY u.id ORDER BY u.code
  `).all(groupId, groupId) as { code: string; name: string; depenses: number; recettes: number }[];

  const rbt = db.prepare(
    "SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total FROM remboursements WHERE group_id = ? AND status IN ('demande', 'valide')"
  ).get(groupId) as { count: number; total: number };

  const sansJustif = db.prepare(`
    SELECT COUNT(*) as count FROM ecritures e
    WHERE e.group_id = ? AND e.type = 'depense'
    AND NOT EXISTS (SELECT 1 FROM justificatifs j WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id)
  `).get(groupId) as { count: number };

  const nonSync = db.prepare(
    "SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND comptaweb_synced = 0 AND status != 'brouillon'"
  ).get(groupId) as { count: number };

  const lastImport = db.prepare(
    'SELECT import_date as date, source_file as fichier FROM comptaweb_imports WHERE group_id = ? ORDER BY import_date DESC LIMIT 1'
  ).get(groupId) as { date: string; fichier: string } | undefined;

  return {
    totalDepenses: dep.total,
    totalRecettes: rec.total,
    solde: rec.total - dep.total,
    totalDepensesFormatted: formatAmount(dep.total),
    totalRecettesFormatted: formatAmount(rec.total),
    soldeFormatted: formatAmount(rec.total - dep.total),
    parUnite: parUnite.map(u => ({ ...u, solde: u.recettes - u.depenses })),
    remboursementsEnAttente: { count: rbt.count, total: rbt.total, totalFormatted: formatAmount(rbt.total) },
    alertes: { depensesSansJustificatif: sansJustif.count, nonSyncComptaweb: nonSync.count },
    dernierImport: lastImport ?? null,
  };
}
