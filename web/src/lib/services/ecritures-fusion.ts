// Fusion de plusieurs brouillons bancaires en UNE écriture (ticket #49).
//
// Cas terrain 2026-11-21 : une famille paie une inscription en plusieurs
// virements. Le scan crée un brouillon par ligne bancaire, alors qu'en
// comptabilité c'est une seule écriture. Monter un brouillon au total laisse
// l'autre en doublon ; supprimer l'autre ne tient pas (le scan le recrée depuis
// sa ligne bancaire).
//
// La fusion garde une écriture CIBLE (choisie par le trésorier) et absorbe les
// autres :
//   - la cible prend la somme des montants, et l'intitulé / l'imputation
//     choisis (par défaut ceux qu'elle avait déjà) ;
//   - les pièces des absorbés (justificatifs, dépôts, remboursements, dépôts
//     d'espèces, avances camp) sont re-pointées vers la cible, leurs notes
//     recopiées dans celles de la cible : rien n'est perdu ;
//   - les absorbés ne sont JAMAIS supprimés (CLAUDE.md « JAMAIS de DELETE ») :
//     ils passent en statut `fusionne` avec `fusionne_dans_id` = la cible. Ils
//     gardent leur ligne bancaire et leur libellé d'origine, ce qui suffit au
//     scan pour les reconnaître (`existants`) et ne pas les recréer ; ce statut
//     les sort des brouillons à traiter et des totaux (`horsFusionnesSql`).
//   - la cible reste reliée à TOUTES les lignes bancaires : la sienne, plus
//     celles de ses absorbés (cf. `lignesBancairesFusion`).
//
// Seuls des brouillons locaux (status `draft`, jamais envoyés à Comptaweb) se
// fusionnent : une écriture déjà dans CW se corrige dans CW.

import { getDb, type DbWrapper } from '../db';
import { currentTimestamp } from '../ids';
import { uniteScopeSql } from '../scope';
import { formatAmount } from '../format';
import type { EcritureContext } from './ecritures';
import type { VentilationInput } from './ecritures-create';
import { ventilateDraft, VENTILATE_MESSAGES } from './ecritures-ventilate';
import { STATUT_FUSIONNE } from './ecritures-status';

export interface FusionInput {
  /** Brouillon conservé : il garde son id, ses pièces et sa ligne bancaire. */
  cibleId: string;
  /** Brouillons absorbés dans la cible (au moins un). */
  absorbesIds: string[];
  /** Intitulé / imputation choisis pour l'écriture fusionnée (absent = celui de la cible). */
  description?: string;
  category_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  /** Découpage de l'écriture fusionnée (somme = total fusionné), cf. ventilateDraft. */
  ventilations?: VentilationInput[];
}

export type FusionResult =
  | {
      ok: true;
      id: string;
      amount_cents: number;
      absorbes: string[];
      lignes_bancaires: LigneBancaireFusion[];
      ventilation_ids?: string[];
    }
  | { ok: false; message: string };

export interface LigneBancaireFusion {
  ecriture_id: string;
  ligne_bancaire_id: number;
  ligne_bancaire_sous_index: number | null;
}

interface Row {
  id: string;
  status: string;
  type: string;
  amount_cents: number;
  comptaweb_ecriture_id: number | null;
  ventilation_group_id: string | null;
  notes: string | null;
}

// Tables qui portent une pièce rattachée à une écriture par `ecriture_id`.
// Certaines sont créées à la demande par leur service (lazy-init, cf.
// AGENTS.md) : une table absente ne porte aucune pièce, on la saute.
const TABLES_PIECES = ['depots_justificatifs', 'remboursements', 'depots_especes', 'avances_camp'];

// Un brouillon a changé de statut entre la lecture et l'écriture (envoi à
// Comptaweb lancé en parallèle) : la transaction est annulée en entier.
class FusionConcurrenteError extends Error {}

/** Lignes bancaires d'une écriture : la sienne, plus celles des brouillons qu'elle a absorbés. */
export async function lignesBancairesFusion(
  db: DbWrapper,
  groupId: string,
  id: string,
): Promise<LigneBancaireFusion[]> {
  return db
    .prepare(
      `SELECT id AS ecriture_id, ligne_bancaire_id, ligne_bancaire_sous_index
         FROM ecritures
        WHERE group_id = ? AND ligne_bancaire_id IS NOT NULL
          AND (id = ? OR (fusionne_dans_id = ? AND status = ?))
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, date_ecriture, id`,
    )
    .all<LigneBancaireFusion>(groupId, id, id, STATUT_FUSIONNE, id);
}

export async function fusionnerBrouillons(
  ctx: EcritureContext,
  input: FusionInput,
  db: DbWrapper = getDb(),
): Promise<FusionResult> {
  const absorbes = [...new Set(input.absorbesIds)].filter((id) => id !== input.cibleId);
  if (absorbes.length === 0) {
    return { ok: false, message: 'Choisis au moins un autre brouillon à fusionner dans la cible.' };
  }
  const ids = [input.cibleId, ...absorbes];

  // Scope multi-unités : un chef ne fusionne que les écritures de SES unités ;
  // une écriture hors scope est traitée comme introuvable (cf. ventilateDraft).
  const conditions = [`id IN (${ids.map(() => '?').join(',')})`, 'group_id = ?'];
  const values: unknown[] = [...ids, ctx.groupId];
  const scope = uniteScopeSql(ctx.scopeUniteIds ?? [], 'unite_id');
  if (scope.sql) { conditions.push(scope.sql); values.push(...scope.params); }
  const rows = await db
    .prepare(
      `SELECT id, status, type, amount_cents, comptaweb_ecriture_id, ventilation_group_id, notes
         FROM ecritures WHERE ${conditions.join(' AND ')}`,
    )
    .all<Row>(...values);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const introuvables = ids.filter((id) => !byId.has(id));
  if (introuvables.length > 0) {
    return { ok: false, message: `Écriture(s) introuvable(s) : ${introuvables.join(', ')}.` };
  }
  const nonBrouillons = rows.filter((r) => r.status !== 'draft' || r.comptaweb_ecriture_id !== null);
  if (nonBrouillons.length > 0) {
    const detail = nonBrouillons
      .map((r) => (r.comptaweb_ecriture_id !== null ? `${r.id} (déjà dans Comptaweb)` : `${r.id} (statut ${r.status})`))
      .join(', ');
    return {
      ok: false,
      message: `Seuls des brouillons se fusionnent ; une écriture déjà envoyée à Comptaweb ou miroir se corrige dans Comptaweb. Refusé : ${detail}.`,
    };
  }
  const ventiles = rows.filter((r) => r.ventilation_group_id !== null);
  if (ventiles.length > 0) {
    return {
      ok: false,
      message: `Brouillon(s) déjà ventilé(s) : ${ventiles.map((r) => r.id).join(', ')}. Repasse-les en une seule ligne (ventiler_ecriture avec une ventilation) avant de fusionner ; le découpage se choisit sur l'écriture fusionnée.`,
    };
  }
  if (new Set(rows.map((r) => r.type)).size > 1) {
    return { ok: false, message: 'Impossible de fusionner une dépense et une recette.' };
  }

  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  if (input.ventilations) {
    const somme = input.ventilations.reduce((s, v) => s + v.amount_cents, 0);
    if (somme !== total) {
      return { ok: false, message: `La somme des détails doit être égale au total fusionné (${formatAmount(total)}).` };
    }
    if (input.ventilations.some((v) => v.amount_cents === 0)) {
      return { ok: false, message: VENTILATE_MESSAGES.incomplete };
    }
  }
  if (input.description !== undefined && input.description.trim() === '') {
    return { ok: false, message: "L'intitulé de l'écriture fusionnée ne peut pas être vide." };
  }

  const now = currentTimestamp();
  const jour = now.slice(0, 10);
  const cible = byId.get(input.cibleId)!;
  const absorbesRows = absorbes.map((id) => byId.get(id)!);

  // Notes de la cible : les siennes, puis la trace de la fusion, puis les
  // notes de chaque absorbé (souvent « Draft généré depuis ligne bancaire N »,
  // qui garde la référence de la ligne lisible depuis la cible).
  const trace = `Fusion du ${jour} : absorbe ${absorbesRows
    .map((r) => `${r.id} (${formatAmount(r.amount_cents)})`)
    .join(', ')}.`;
  const notesCible = [
    cible.notes,
    trace,
    ...absorbesRows.filter((r) => r.notes).map((r) => `[${r.id}] ${r.notes}`),
  ]
    .filter(Boolean)
    .join('\n');

  const sets = ['amount_cents = ?', 'notes = ?', 'updated_at = ?'];
  const setValues: unknown[] = [total, notesCible, now];
  if (input.description !== undefined) { sets.push('description = ?'); setValues.push(input.description.trim()); }
  if (input.category_id !== undefined) { sets.push('category_id = ?'); setValues.push(input.category_id); }
  if (input.unite_id !== undefined) { sets.push('unite_id = ?'); setValues.push(input.unite_id); }
  if (input.activite_id !== undefined) { sets.push('activite_id = ?'); setValues.push(input.activite_id); }

  const tables = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${TABLES_PIECES.map(() => '?').join(',')})`,
    )
    .all<{ name: string }>(...TABLES_PIECES);
  const tablesPresentes = TABLES_PIECES.filter((t) => tables.some((r) => r.name === t));

  const absorbesPlaceholders = absorbes.map(() => '?').join(',');
  try {
    await db.transaction(async (tx) => {
      // `AND status = 'draft'` referme la fenêtre entre la lecture et
      // l'écriture (envoi à Comptaweb lancé entre-temps) : tout est annulé.
      const maj = await tx
        .prepare(`UPDATE ecritures SET ${sets.join(', ')} WHERE id = ? AND group_id = ? AND status = 'draft'`)
        .run(...setValues, cible.id, ctx.groupId);
      if (maj.changes !== 1) throw new FusionConcurrenteError(cible.id);

      await tx
        .prepare(
          `UPDATE justificatifs SET entity_id = ?
            WHERE entity_type = 'ecriture' AND entity_id IN (${absorbesPlaceholders})`,
        )
        .run(cible.id, ...absorbes);
      for (const table of tablesPresentes) {
        await tx
          .prepare(`UPDATE ${table} SET ecriture_id = ? WHERE ecriture_id IN (${absorbesPlaceholders})`)
          .run(cible.id, ...absorbes);
      }

      for (const r of absorbesRows) {
        const notes = [r.notes, `Fusionné le ${jour} dans ${cible.id}.`].filter(Boolean).join('\n');
        const res = await tx
          .prepare(
            `UPDATE ecritures SET status = ?, fusionne_dans_id = ?, notes = ?, updated_at = ?
              WHERE id = ? AND group_id = ? AND status = 'draft'`,
          )
          .run(STATUT_FUSIONNE, cible.id, notes, now, r.id, ctx.groupId);
        if (res.changes !== 1) throw new FusionConcurrenteError(r.id);
      }
    });
  } catch (err) {
    if (err instanceof FusionConcurrenteError) {
      return { ok: false, message: `Le brouillon ${err.message} a changé pendant la fusion : rien n'a été fusionné, réessaie.` };
    }
    throw err;
  }

  let ventilationIds: string[] | undefined;
  if (input.ventilations && input.ventilations.length > 0) {
    const v = await ventilateDraft(ctx, cible.id, input.ventilations, db);
    if (!v.ok) {
      return {
        ok: false,
        message: `Fusion faite dans ${cible.id}, mais découpage refusé : ${VENTILATE_MESSAGES[v.reason ?? 'not_found']}`,
      };
    }
    ventilationIds = v.ids;
  }

  return {
    ok: true,
    id: cible.id,
    amount_cents: total,
    absorbes,
    lignes_bancaires: await lignesBancairesFusion(db, ctx.groupId, cible.id),
    ...(ventilationIds ? { ventilation_ids: ventilationIds } : {}),
  };
}
