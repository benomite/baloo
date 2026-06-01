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

// Une écriture flaggée est en réalité un AGRÉGAT (doublon remplacé par ses
// ventilations) si son comptaweb_ecriture_id est encore partagé par d'autres
// écritures VIVANTES (= les lignes par ventilation, toujours dans CW). Ce
// critère reclasse aussi les écritures legacy taguées `supprimee_cw` avant
// l'introduction du statut `agrege_remplace`.
const SHARED_CW_ID = `
  EXISTS (
    SELECT 1 FROM ecritures e2
    WHERE e2.group_id = e.group_id
      AND e2.comptaweb_ecriture_id = e.comptaweb_ecriture_id
      AND e2.id <> e.id
      AND e2.status IN ('mirror','pending_sync','divergent')
  )`;

/** Vraies suppressions CW : écriture flaggée dont le cwId a totalement disparu. */
export async function listSupprimeeCw(groupId: string): Promise<SupprimeeCwRow[]> {
  return getDb()
    .prepare(
      `SELECT id, date_ecriture, description, amount_cents, type, cw_numero_piece
       FROM ecritures e
       WHERE group_id = ? AND status IN ('supprimee_cw','agrege_remplace')
         AND (comptaweb_ecriture_id IS NULL OR NOT ${SHARED_CW_ID})
       ORDER BY date_ecriture DESC`,
    )
    .all<SupprimeeCwRow>(groupId);
}

/**
 * Agrégats remplacés par le détail de leurs ventilations (doublons à
 * supprimer). L'écriture EXISTE toujours dans Comptaweb : c'est l'ancienne
 * ligne « total » qui fait doublon avec les lignes par ventilation (cwId
 * encore partagé par des écritures vivantes).
 */
export async function listAgregesRemplaces(groupId: string): Promise<SupprimeeCwRow[]> {
  return getDb()
    .prepare(
      `SELECT id, date_ecriture, description, amount_cents, type, cw_numero_piece
       FROM ecritures e
       WHERE group_id = ? AND status IN ('supprimee_cw','agrege_remplace')
         AND comptaweb_ecriture_id IS NOT NULL AND ${SHARED_CW_ID}
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
