// Queries de lecture pour la file d'arbitrage de la réconciliation
// (spec 2026-06-01) : écritures `supprimee_cw` + suggestions de lien
// `a_confirmer`. Lecture seule — sans `'use server'` (helpers serveur,
// cf. AGENTS.md « 'use server' ≠ helpers serveur »).

import { getDb } from '../db';

export interface SupprimeeCwRow {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  cw_numero_piece: string | null;
}

export interface LinkSuggestionView {
  id: string;
  ecriture_id: string;
  ecriture_description: string;
  ecriture_amount_cents: number;
  ecriture_date: string;
  cw_ecriture_id: number;
  cw_numero_piece: string | null;
  cw_montant_cents: number | null;
  cw_date: string | null;
  cw_intitule: string | null;
}

export async function listSupprimeeCw(groupId: string): Promise<SupprimeeCwRow[]> {
  return getDb()
    .prepare(
      `SELECT id, date_ecriture, description, amount_cents, type, cw_numero_piece
       FROM ecritures
       WHERE group_id = ? AND status = 'supprimee_cw'
       ORDER BY date_ecriture DESC`,
    )
    .all<SupprimeeCwRow>(groupId);
}

export async function listLinkSuggestions(groupId: string): Promise<LinkSuggestionView[]> {
  return getDb()
    .prepare(
      `SELECT s.id, s.ecriture_id, s.cw_ecriture_id, s.cw_numero_piece,
              s.cw_montant_cents, s.cw_date, s.cw_intitule,
              e.description AS ecriture_description,
              e.amount_cents AS ecriture_amount_cents,
              e.date_ecriture AS ecriture_date
       FROM cw_link_suggestions s
       JOIN ecritures e ON e.id = s.ecriture_id
       WHERE s.group_id = ? AND s.status = 'a_confirmer'
       ORDER BY s.created_at DESC`,
    )
    .all<LinkSuggestionView>(groupId);
}
