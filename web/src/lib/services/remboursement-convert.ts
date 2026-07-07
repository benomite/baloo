import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';

// Convertit une demande de remboursement soumise PAR ERREUR (le déposeur
// voulait déposer un justif d'une dépense déjà payée par le groupe, pas être
// remboursé) en dépôt / justif d'écriture.
//
// Principe : additif et non destructif.
//  - Le(s) justif(s) métier du remboursement (entity_type='remboursement')
//    sont RÉUTILISÉS (même blob, nouvelle ligne justificatifs) :
//      · si le remboursement est lié à une écriture → justif direct sur
//        l'écriture (elle devient justifiée pour de vrai), puis on délie ;
//      · sinon → on crée un dépôt (a_traiter) portant le justif, à rapprocher
//        plus tard.
//  - Le RIB, la feuille et le justif d'origine restent sur le remboursement
//    (rien de perdu).
//  - Le remboursement passe au statut terminal 'converti' — PAS 'refuse' :
//    aucune notification de refus n'est envoyée au parent (ce n'est pas un
//    rejet, c'est une correction de process).

export interface ConvertRemboursementResult {
  status: 'converti';
  targetEcritureId: string | null;
  createdDepotId: string | null;
  copied: number;
}

interface JustifRow {
  file_path: string;
  original_filename: string;
  mime_type: string | null;
}

export async function convertRemboursementToDepot(
  { groupId }: { groupId: string },
  rembId: string,
): Promise<ConvertRemboursementResult> {
  const db = getDb();

  const remb = await db
    .prepare(
      `SELECT id, status, ecriture_id, nature, total_cents, amount_cents, unite_id, date_depense
       FROM remboursements WHERE id = ? AND group_id = ?`,
    )
    .get<{
      id: string;
      status: string;
      ecriture_id: string | null;
      nature: string | null;
      total_cents: number | null;
      amount_cents: number | null;
      unite_id: string | null;
      date_depense: string | null;
    }>(rembId, groupId);
  if (!remb) throw new Error(`Remboursement ${rembId} introuvable dans ce groupe.`);
  if (remb.status === 'converti') throw new Error(`Remboursement ${rembId} déjà converti en dépôt.`);

  // Justifs MÉTIER du remboursement (pas le RIB ni la feuille).
  const sources = await db
    .prepare(
      `SELECT file_path, original_filename, mime_type
       FROM justificatifs WHERE group_id = ? AND entity_type = 'remboursement' AND entity_id = ?`,
    )
    .all<JustifRow>(groupId, rembId);

  // Copie une source vers une entité cible (même blob, ligne dédiée),
  // idempotente sur (entity, file_path).
  const copyTo = async (entityType: 'ecriture' | 'depot', entityId: string): Promise<number> => {
    let copied = 0;
    for (const f of sources) {
      const already = await db
        .prepare(
          `SELECT 1 FROM justificatifs WHERE group_id = ? AND entity_type = ? AND entity_id = ? AND file_path = ?`,
        )
        .get<{ 1: number }>(groupId, entityType, entityId, f.file_path);
      if (already) continue;
      const id = await nextId('JUS');
      await db
        .prepare(
          `INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, groupId, f.file_path, f.original_filename, f.mime_type, entityType, entityId, currentTimestamp());
      copied++;
    }
    return copied;
  };

  let targetEcritureId: string | null = null;
  let createdDepotId: string | null = null;
  let copied = 0;

  if (remb.ecriture_id) {
    // Lié : le justif devient un justif DIRECT de l'écriture, puis on délie.
    copied = await copyTo('ecriture', remb.ecriture_id);
    targetEcritureId = remb.ecriture_id;
    await db
      .prepare(`UPDATE remboursements SET ecriture_id = NULL, updated_at = ? WHERE id = ? AND group_id = ?`)
      .run(currentTimestamp(), rembId, groupId);
  } else {
    // Non lié : on crée un dépôt a_traiter portant le justif.
    createdDepotId = await nextId('DEP');
    const now = currentTimestamp();
    await db
      .prepare(
        `INSERT INTO depots_justificatifs (id, group_id, submitted_by_user_id, titre, amount_cents, date_estimee, unite_id, statut, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'a_traiter', ?, ?)`,
      )
      .run(createdDepotId, groupId, remb.nature ?? 'Justificatif', remb.total_cents ?? remb.amount_cents ?? null, remb.date_depense, remb.unite_id, now, now);
    copied = await copyTo('depot', createdDepotId);
  }

  // Neutralisation SANS email : statut terminal 'converti' (pas 'refuse').
  await db
    .prepare(
      `UPDATE remboursements
         SET status = 'converti',
             motif_refus = COALESCE(motif_refus, 'Converti en dépôt (déposé par erreur en remboursement).'),
             updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(currentTimestamp(), rembId, groupId);

  return { status: 'converti', targetEcritureId, createdDepotId, copied };
}
