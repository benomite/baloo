// Suggestions de lien draft Baloo ↔ écriture Comptaweb (spec 2026-06-01).
//
// Quand un draft local correspond à une ligne CW par contenu mais que le
// match est AMBIGU (plusieurs candidats), on ne devine pas : on enregistre
// une suggestion « à confirmer » que l'utilisateur arbitre dans /ecritures.
//
// Règle projet : pas de DELETE. On UPSERT (INSERT si absent) et on fait
// évoluer `status` (a_confirmer → confirme | rejete).

import type { DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';

export type LinkSuggestionStatus = 'a_confirmer' | 'confirme' | 'rejete';

export interface CwLinkSuggestionRow {
  id: string;
  group_id: string;
  ecriture_id: string;
  cw_ecriture_id: number;
  cw_numero_piece: string | null;
  cw_montant_cents: number | null;
  cw_date: string | null;
  cw_intitule: string | null;
  status: LinkSuggestionStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface SuggestionInput {
  groupId: string;
  ecritureId: string;
  cwEcritureId: number;
  cwNumeroPiece?: string | null;
  cwMontantCents?: number | null;
  cwDate?: string | null;
  cwIntitule?: string | null;
}

/**
 * Crée une suggestion `a_confirmer` si aucune suggestion non-rejetée
 * n'existe déjà pour le couple (ecriture_id, cw_ecriture_id). Idempotent :
 * une suggestion déjà `a_confirmer` ou `confirme` n'est pas recréée. Une
 * suggestion `rejete` ne ressuscite pas non plus (le rejet est définitif —
 * la ligne CW sera importée comme écriture distincte).
 *
 * Retourne l'id de la suggestion existante ou créée (null si rejet en place).
 */
export async function upsertSuggestion(
  db: DbWrapper,
  input: SuggestionInput,
): Promise<string | null> {
  const existing = await db
    .prepare(
      `SELECT id, status FROM cw_link_suggestions
       WHERE group_id = ? AND ecriture_id = ? AND cw_ecriture_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get<{ id: string; status: LinkSuggestionStatus }>(
      input.groupId,
      input.ecritureId,
      input.cwEcritureId,
    );

  if (existing) {
    // Déjà connue (peu importe le statut) → on ne recrée pas.
    return existing.status === 'rejete' ? null : existing.id;
  }

  const id = await nextIdOn(db, 'CWLINK', { tables: ['cw_link_suggestions'] });
  const now = currentTimestamp();
  await db
    .prepare(
      `INSERT INTO cw_link_suggestions
         (id, group_id, ecriture_id, cw_ecriture_id, cw_numero_piece,
          cw_montant_cents, cw_date, cw_intitule, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'a_confirmer', ?)`,
    )
    .run(
      id,
      input.groupId,
      input.ecritureId,
      input.cwEcritureId,
      input.cwNumeroPiece ?? null,
      input.cwMontantCents ?? null,
      input.cwDate ?? null,
      input.cwIntitule ?? null,
      now,
    );
  return id;
}

export async function listSuggestions(
  db: DbWrapper,
  groupId: string,
  status: LinkSuggestionStatus = 'a_confirmer',
): Promise<CwLinkSuggestionRow[]> {
  return db
    .prepare(
      `SELECT * FROM cw_link_suggestions
       WHERE group_id = ? AND status = ?
       ORDER BY created_at DESC`,
    )
    .all<CwLinkSuggestionRow>(groupId, status);
}

export async function getSuggestion(
  db: DbWrapper,
  id: string,
): Promise<CwLinkSuggestionRow | undefined> {
  return db
    .prepare(`SELECT * FROM cw_link_suggestions WHERE id = ?`)
    .get<CwLinkSuggestionRow>(id);
}

/**
 * Fait évoluer une suggestion vers `confirme` ou `rejete`. Pas de DELETE.
 */
export async function resolveSuggestion(
  db: DbWrapper,
  id: string,
  status: 'confirme' | 'rejete',
): Promise<void> {
  await db
    .prepare(
      `UPDATE cw_link_suggestions SET status = ?, resolved_at = ? WHERE id = ?`,
    )
    .run(status, currentTimestamp(), id);
}
