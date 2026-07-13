// Éclatement / collapse d'un draft en N ventilations groupées. La ligne
// « tête » (headId) est mise à jour (jamais recréée) → justifs, notes,
// liens et identité bancaire préservés. Cf. spec 2026-07-13.

import { randomUUID } from 'node:crypto';
import { getDb, type DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { deleteDraftEcriture, type EcritureContext } from './ecritures';
import type { VentilationInput } from './ecritures-create';

export type VentilateReason =
  | 'not_found' | 'not_draft' | 'in_cw' | 'sum_mismatch' | 'incomplete' | 'child_has_attachments';

export interface VentilateDraftResult {
  ok: boolean;
  reason?: VentilateReason;
  ventilation_group_id?: string | null;
  ids?: string[];
}

interface HeadRow {
  id: string; group_id: string; date_ecriture: string; description: string;
  amount_cents: number; type: 'depense' | 'recette'; mode_paiement_id: string | null;
  numero_piece: string | null; carte_id: string | null; justif_attendu: number;
  notes: string | null; ligne_bancaire_id: number | null; ligne_bancaire_sous_index: number | null;
  libelle_origine: string | null; ventilation_group_id: string | null;
  comptaweb_ecriture_id: number | null; status: string;
}

class VentilateError extends Error {
  constructor(public reason: VentilateReason) { super(reason); }
}

export async function ventilateDraft(
  ctx: EcritureContext,
  headId: string,
  ventilations: VentilationInput[],
  db: DbWrapper = getDb(),
): Promise<VentilateDraftResult> {
  const head = await db.prepare(
    `SELECT id, group_id, date_ecriture, description, amount_cents, type, mode_paiement_id,
            numero_piece, carte_id, justif_attendu, notes, ligne_bancaire_id,
            ligne_bancaire_sous_index, libelle_origine, ventilation_group_id,
            comptaweb_ecriture_id, status
       FROM ecritures WHERE id = ? AND group_id = ?`,
  ).get<HeadRow>(headId, ctx.groupId);
  if (!head) return { ok: false, reason: 'not_found' };
  if (head.status !== 'draft') return { ok: false, reason: 'not_draft' };
  if (head.comptaweb_ecriture_id !== null) return { ok: false, reason: 'in_cw' };

  // Membres actuels du groupe (dont la tête).
  const members = head.ventilation_group_id
    ? await db.prepare(
        `SELECT id, amount_cents FROM ecritures WHERE group_id = ? AND ventilation_group_id = ?`,
      ).all<{ id: string; amount_cents: number }>(ctx.groupId, head.ventilation_group_id)
    : [{ id: head.id, amount_cents: head.amount_cents }];
  const total = members.reduce((s, m) => s + m.amount_cents, 0);

  // Validations métier (avant toute mutation).
  const sum = ventilations.reduce((s, v) => s + v.amount_cents, 0);
  if (sum !== total) return { ok: false, reason: 'sum_mismatch' };
  const incomplete = ventilations.some(
    (v) => v.amount_cents === 0 || !v.category_id || !v.unite_id || !v.activite_id,
  );
  if (incomplete) return { ok: false, reason: 'incomplete' };

  const now = currentTimestamp();
  const newVg = ventilations.length >= 2 ? (head.ventilation_group_id ?? `vg_${randomUUID()}`) : null;
  const ids: string[] = [];

  try {
    await db.transaction(async (txDb) => {
      // 1. Supprimer les membres autres que la tête (garde-fou pièces).
      for (const m of members) {
        if (m.id === head.id) continue;
        const del = await deleteDraftEcriture(ctx, m.id, txDb);
        if (!del.ok) {
          throw new VentilateError(del.reason === 'has_attachments' ? 'child_has_attachments' : 'not_draft');
        }
      }
      // 2. Mettre à jour la tête avec la 1ʳᵉ ventilation + le vg.
      const v0 = ventilations[0];
      await txDb.prepare(
        `UPDATE ecritures
            SET amount_cents = ?, category_id = ?, unite_id = ?, activite_id = ?,
                ventilation_group_id = ?, updated_at = ?
          WHERE id = ? AND group_id = ?`,
      ).run(v0.amount_cents, v0.category_id ?? null, v0.unite_id ?? null, v0.activite_id ?? null, newVg, now, head.id, ctx.groupId);
      ids.push(head.id);
      // 3. Insérer les ventilations 2..N (copie des champs d'en-tête de la tête).
      for (const v of ventilations.slice(1)) {
        const id = await nextIdOn(txDb, 'ECR');
        await txDb.prepare(
          `INSERT INTO ecritures (
             id, group_id, date_ecriture, description, amount_cents, type, unite_id,
             category_id, mode_paiement_id, activite_id, numero_piece, carte_id,
             justif_attendu, notes, ligne_bancaire_id, ligne_bancaire_sous_index,
             libelle_origine, ventilation_group_id, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        ).run(
          id, ctx.groupId, head.date_ecriture, head.description, v.amount_cents, head.type,
          v.unite_id ?? null, v.category_id ?? null, head.mode_paiement_id, v.activite_id ?? null,
          head.numero_piece, head.carte_id, head.justif_attendu, head.notes,
          head.ligne_bancaire_id, head.ligne_bancaire_sous_index, head.libelle_origine, newVg, now, now,
        );
        ids.push(id);
      }
    });
  } catch (err) {
    if (err instanceof VentilateError) return { ok: false, reason: err.reason };
    throw err;
  }

  return { ok: true, ventilation_group_id: newVg, ids };
}
