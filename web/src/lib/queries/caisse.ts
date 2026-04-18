import { getDb } from '../db';
import type { MouvementCaisse } from '../types';

export function listMouvementsCaisse(limit = 50): { mouvements: MouvementCaisse[]; solde: number } {
  const mouvements = getDb().prepare(
    'SELECT * FROM mouvements_caisse ORDER BY date_mouvement DESC, created_at DESC LIMIT ?'
  ).all(limit) as MouvementCaisse[];

  const soldeRow = getDb().prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse'
  ).get() as { total: number };

  return { mouvements, solde: soldeRow.total };
}
