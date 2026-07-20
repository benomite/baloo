import { getDb } from '../db';
import { currentTimestamp } from '../ids';

// Rattachement justif ↔ ligne de détail d'un remboursement (spec
// 2026-07-20). Liaison plusieurs-à-plusieurs, affectation côté trésorier.
// Aucun upload : on ne fait que relier des justifs DÉJÀ déposés sur la
// demande (entity_type='remboursement') à ses lignes de détail.

export interface LigneJustifAssignation {
  ligne_id: string;
  justificatif_id: string;
}

export async function listAssignationsLignes(
  remboursementId: string,
): Promise<LigneJustifAssignation[]> {
  return await getDb()
    .prepare(
      `SELECT rlj.ligne_id, rlj.justificatif_id
       FROM remboursement_ligne_justificatifs rlj
       JOIN remboursement_lignes l ON l.id = rlj.ligne_id
       WHERE l.remboursement_id = ?
       ORDER BY rlj.ligne_id, rlj.justificatif_id`,
    )
    .all<LigneJustifAssignation>(remboursementId);
}

// Remplace l'ensemble des lignes couvertes par CE justif. `ligneIds` vide
// = on retire toutes ses affectations. Garde-fous : le justif et chaque
// ligne doivent appartenir à la même demande / au même groupe.
export async function setJustificatifLignes(
  { groupId }: { groupId: string },
  remboursementId: string,
  justificatifId: string,
  ligneIds: string[],
): Promise<void> {
  const db = getDb();

  const justif = await db
    .prepare(
      `SELECT id FROM justificatifs
       WHERE id = ? AND group_id = ? AND entity_type = 'remboursement' AND entity_id = ?`,
    )
    .get<{ id: string }>(justificatifId, groupId, remboursementId);
  if (!justif) {
    throw new Error(`Justificatif ${justificatifId} introuvable sur la demande ${remboursementId}.`);
  }

  const wanted = [...new Set(ligneIds)];
  for (const ligneId of wanted) {
    const ligne = await db
      .prepare('SELECT id FROM remboursement_lignes WHERE id = ? AND remboursement_id = ?')
      .get<{ id: string }>(ligneId, remboursementId);
    if (!ligne) {
      throw new Error(`Ligne ${ligneId} n'appartient pas à la demande ${remboursementId}.`);
    }
  }

  // Réaffectation : on efface les paires de CE justif (table de liaison
  // pure, aucune donnée métier attachée) puis on ré-insère la sélection.
  await db
    .prepare('DELETE FROM remboursement_ligne_justificatifs WHERE justificatif_id = ?')
    .run(justificatifId);
  const now = currentTimestamp();
  for (const ligneId of wanted) {
    await db
      .prepare(
        'INSERT INTO remboursement_ligne_justificatifs (ligne_id, justificatif_id, created_at) VALUES (?, ?, ?)',
      )
      .run(ligneId, justificatifId, now);
  }
}

// Helper pur : combien de lignes ont au moins un justif rattaché.
export function computeCouverture(
  lignes: { id: string }[],
  assignations: { ligne_id: string }[],
): { justifiees: number; total: number } {
  const couvertes = new Set(assignations.map((a) => a.ligne_id));
  const justifiees = lignes.filter((l) => couvertes.has(l.id)).length;
  return { justifiees, total: lignes.length };
}
