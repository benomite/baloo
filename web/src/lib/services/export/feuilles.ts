// Feuille de remboursement dans le dossier d'exercice (ticket #43).
//
// La feuille stockée (`justificatifs.entity_type = 'remboursement_feuille'`)
// imprime l'IBAN / BIC du demandeur en clair : on ne la copie pas. On
// RÉGÉNÈRE à la place la même feuille — même rendu que celui de la
// signature (`renderFeuilleRemboursementCourante`), mêmes données, même
// chaîne de signatures, même date de génération — avec les coordonnées
// bancaires remplacées par une mention. L'IBAN n'est jamais écrit dans le
// fichier : rien à extraire d'un calque ou d'un texte caché.
//
// La feuille stockée elle-même n'est pas touchée : l'app, l'envoi pour
// paiement et `pnpm export:dump` continuent de lire l'originale.

import { getDb } from '../../db';
import { renderFeuilleRemboursementCourante } from '../remboursement-signing';

// `null` : la demande n'a jamais eu de feuille générée (ou seulement des
// versions marquées obsolètes) — pas de feuille dans son dossier, comme
// le dit la colonne `feuille_signee` de `remboursements.csv`, qui lit la
// même condition.
export async function feuilleArchiveMasquee(groupId: string, rbtId: string): Promise<Buffer | null> {
  const courante = await getDb()
    .prepare(
      `SELECT uploaded_at FROM justificatifs
        WHERE group_id = ? AND entity_type = 'remboursement_feuille' AND entity_id = ?
          AND obsolete_at IS NULL
        ORDER BY uploaded_at DESC
        LIMIT 1`,
    )
    .get<{ uploaded_at: string }>(groupId, rbtId);
  if (!courante) return null;

  return await renderFeuilleRemboursementCourante({
    groupId,
    rbtId,
    // La date que porte la feuille stockée : celle de sa dernière génération.
    submittedAt: String(courante.uploaded_at).slice(0, 10),
    masquerCoordonneesBancaires: true,
  });
}
