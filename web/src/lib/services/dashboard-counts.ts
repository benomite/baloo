// Compteurs SQL du dashboard trésorier (Phase 4 pivot miroir).
// Fonctions à injection de `db` → testables in-memory (cf. db.ts wrapClient).
// Lecture seule : aucun DELETE/UPDATE (cf. règle CLAUDE.md).
import type { DbWrapper } from '../db';

export async function countDepotsATraiter(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM depots_justificatifs WHERE group_id = ? AND statut = 'a_traiter'")
    .get<{ count: number }>(groupId);
  return row?.count ?? 0;
}

export async function countAbandonsATraiter(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM abandons_frais WHERE group_id = ? AND status IN ('a_traiter', 'valide')")
    .get<{ count: number }>(groupId);
  return row?.count ?? 0;
}

export async function countDraftsBancaires(db: DbWrapper, groupId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM ecritures WHERE group_id = ? AND status = 'draft' AND ligne_bancaire_id IS NOT NULL")
    .get<{ count: number }>(groupId);
  return row?.count ?? 0;
}
