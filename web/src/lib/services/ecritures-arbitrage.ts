// Arbitrage utilisateur des sorties de la réconciliation (spec 2026-06-01) :
//   - écritures `supprimee_cw` : restaurer en draft, ou supprimer pour de bon
//     (uniquement si aucune pièce attachée — garde-fou canHardDelete).
//   - suggestions de lien draft↔CW : confirmer (promotion) ou rejeter.
//
// Toute la logique BDD vit ici (db injectable, testable). Les server actions
// (`lib/actions/ecritures-arbitrage.ts`) ne font que router le contexte +
// revalidatePath.

import type { DbWrapper } from '../db';
import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import { canHardDelete, type EcritureStatus } from './ecritures-sync-transitions';
import { getSuggestion, resolveSuggestion } from './cw-link-suggestions';

export type ArbitrageReason = 'not_found' | 'wrong_status' | 'has_attachments' | 'not_pending';
export interface ArbitrageResult {
  ok: boolean;
  reason?: ArbitrageReason;
}

async function countAttachments(db: DbWrapper, ecritureId: string): Promise<number> {
  const justifs = await db
    .prepare(`SELECT COUNT(*) as n FROM justificatifs WHERE entity_type = 'ecriture' AND entity_id = ?`)
    .get<{ n: number }>(ecritureId);
  const depots = await db
    .prepare('SELECT COUNT(*) as n FROM depots_justificatifs WHERE ecriture_id = ?')
    .get<{ n: number }>(ecritureId);
  const rembs = await db
    .prepare('SELECT COUNT(*) as n FROM remboursements WHERE ecriture_id = ?')
    .get<{ n: number }>(ecritureId);
  return (justifs?.n ?? 0) + (depots?.n ?? 0) + (rembs?.n ?? 0);
}

/** Restaure une écriture `supprimee_cw` en brouillon local. */
export async function restoreSupprimeeToDraft(
  groupId: string,
  id: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const cur = await db
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ status: EcritureStatus }>(id, groupId);
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status !== 'supprimee_cw' && cur.status !== 'agrege_remplace') {
    return { ok: false, reason: 'wrong_status' };
  }
  await db
    .prepare(`UPDATE ecritures SET status = 'draft', comptaweb_ecriture_id = NULL, updated_at = ? WHERE id = ? AND group_id = ?`)
    .run(currentTimestamp(), id, groupId);
  return { ok: true };
}

/**
 * Supprime définitivement une écriture `supprimee_cw` — seulement si aucune
 * pièce n'est attachée (garde-fou canHardDelete + CLAUDE.md « JAMAIS de
 * DELETE » sauf draft/supprimee_cw vide).
 */
export async function deleteArbitratedEcriture(
  groupId: string,
  id: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const cur = await db
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ status: EcritureStatus }>(id, groupId);
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status !== 'supprimee_cw' && cur.status !== 'agrege_remplace') {
    return { ok: false, reason: 'wrong_status' };
  }
  const attachments = await countAttachments(db, id);
  if (!canHardDelete(cur.status, attachments > 0)) {
    return { ok: false, reason: 'has_attachments' };
  }
  await db
    .prepare(
      `DELETE FROM ecritures WHERE id = ? AND group_id = ? AND status IN ('supprimee_cw','agrege_remplace')`,
    )
    .run(id, groupId);
  return { ok: true };
}

/**
 * Confirme une suggestion de lien : pose la clé stable
 * (comptaweb_ecriture_id) sur le draft + copie les infos CW connues, passe
 * en `mirror`. `cw_signature = NULL` force la prochaine sync à relire le
 * détail (activité/branche) et à réaligner finement. Marque la suggestion
 * `confirme` et rejette les autres suggestions ouvertes du même draft.
 */
export async function confirmLink(
  groupId: string,
  suggestionId: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const sugg = await getSuggestion(db, suggestionId);
  if (!sugg || sugg.group_id !== groupId) return { ok: false, reason: 'not_found' };
  if (sugg.status !== 'a_confirmer') return { ok: false, reason: 'not_pending' };

  const ecr = await db
    .prepare('SELECT status FROM ecritures WHERE id = ? AND group_id = ?')
    .get<{ status: EcritureStatus }>(sugg.ecriture_id, groupId);
  if (!ecr) return { ok: false, reason: 'not_found' };

  const now = currentTimestamp();
  await db
    .prepare(
      `UPDATE ecritures SET
         comptaweb_ecriture_id = ?, cw_numero_piece = ?,
         amount_cents = COALESCE(?, amount_cents),
         date_ecriture = COALESCE(?, date_ecriture),
         description = COALESCE(?, description),
         cw_signature = NULL, status = 'mirror', comptaweb_synced = 1, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(
      sugg.cw_ecriture_id,
      sugg.cw_numero_piece,
      sugg.cw_montant_cents,
      sugg.cw_date,
      sugg.cw_intitule,
      now,
      sugg.ecriture_id,
      groupId,
    );

  await resolveSuggestion(db, suggestionId, 'confirme');
  // Les autres suggestions ouvertes du même draft n'ont plus lieu d'être.
  await db
    .prepare(
      `UPDATE cw_link_suggestions SET status = 'rejete', resolved_at = ?
       WHERE group_id = ? AND ecriture_id = ? AND status = 'a_confirmer'`,
    )
    .run(now, groupId, sugg.ecriture_id);

  return { ok: true };
}

/** Rejette une suggestion de lien (la ligne CW sera importée distinctement). */
export async function rejectLink(
  groupId: string,
  suggestionId: string,
  db: DbWrapper = getDb(),
): Promise<ArbitrageResult> {
  const sugg = await getSuggestion(db, suggestionId);
  if (!sugg || sugg.group_id !== groupId) return { ok: false, reason: 'not_found' };
  if (sugg.status !== 'a_confirmer') return { ok: false, reason: 'not_pending' };
  await resolveSuggestion(db, suggestionId, 'rejete');
  return { ok: true };
}
