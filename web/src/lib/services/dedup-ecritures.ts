// Détection et suppression des écritures doublons générées par les
// imports CSV Comptaweb successifs. Avant le fix UPSERT (commit 8a72f43),
// les imports faisaient DELETE+INSERT ; et même après, le matching par
// (group, date, amount, type, piece) pouvait rater quand piece ou
// description avaient changé entre 2 imports — produisant des doublons
// "vides" (sans description, sans imputation) qui se cumulent aux
// écritures complètes.
//
// Stratégie :
// 1. Grouper par (group, date, amount, type, numero_piece, description,
//    category_id). Ces 7 champs forment l'identité d'une écriture — 2
//    lignes qui les partagent sont vraiment des doublons. Sans
//    description+piece+cat, on confondait des ventilations distinctes :
//    - mestre 568€ Participation piece=10 vs chabrol 568€ Cotisations
//      piece=6 (mêmes date/amount/type mais écritures différentes)
//    - Ruseva 24€ vs LeRest 24€ (Inscriptions Impeesa différentes le
//      même jour)
//    - Regroupement prélèvements 420€ Territoire vs 420€ FSI (mêmes
//      date/amount/type/piece/description, ventilations distinctes
//      différenciées par catégorie uniquement)
// 2. Choisir la "meilleure" par scoring (description renseignée, unite_id,
//    category_id, mode_paiement_id, activite_id, justif_attendu, notes).
// 3. Pour les autres : DELETE seulement si elles n'ont AUCUN lien externe :
//    - aucun justificatif uploadé qui pointe vers leur id
//    - aucun depots_justificatifs.ecriture_id pointant vers leur id
//    - aucun remboursements.ecriture_id pointant vers leur id
//    Sinon on les garde (le user a enrichi quelque chose dessus).

import { getDb } from '../db';

export interface DedupCandidate {
  id: string;
  description: string | null;
  numero_piece: string | null;
  unite_id: string | null;
  unite_name: string | null;
  category_id: string | null;
  category_name: string | null;
  notes: string | null;
  has_links: boolean; // a un justif/dépôt/remb attaché
  score: number;
}

export interface DedupGroup {
  date: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  candidates: DedupCandidate[];
  keepId: string;
  toDeleteIds: string[]; // candidats à supprimer (sans liens externes)
  toKeepDespiteIds: string[]; // doublons gardés car liens externes
}

export interface DedupReport {
  groups: DedupGroup[];
  totalDuplicates: number;
  totalDeletable: number;
  totalKeptDespite: number;
}

interface EcritureRow {
  id: string;
  date_ecriture: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  description: string | null;
  numero_piece: string | null;
  unite_id: string | null;
  unite_name: string | null;
  category_id: string | null;
  category_name: string | null;
  mode_paiement_id: string | null;
  activite_id: string | null;
  notes: string | null;
}

function scoreEcriture(e: EcritureRow): number {
  let s = 0;
  if (e.description && e.description.trim().length > 0) s += 100 + Math.min(e.description.length, 50);
  if (e.unite_id) s += 20;
  if (e.category_id) s += 20;
  if (e.mode_paiement_id) s += 10;
  if (e.activite_id) s += 10;
  if (e.notes && e.notes.length > 30) s += 5;
  return s;
}

export async function findCsvDuplicates({ groupId }: { groupId: string }): Promise<DedupReport> {
  const db = getDb();
  // Cherche les tuples (date, amount, type) qui ont au moins 2 écritures
  // saisie_comptaweb dans ce groupe.
  const dupKeys = await db
    .prepare(
      `SELECT date_ecriture, amount_cents, type,
              COALESCE(numero_piece, '') as piece,
              COALESCE(description, '') as descr,
              COALESCE(category_id, '') as cat,
              COUNT(*) as cnt
       FROM ecritures
       WHERE group_id = ? AND status = 'saisie_comptaweb'
       GROUP BY date_ecriture, amount_cents, type,
                COALESCE(numero_piece, ''), COALESCE(description, ''),
                COALESCE(category_id, '')
       HAVING cnt > 1
       ORDER BY date_ecriture DESC`,
    )
    .all<{ date_ecriture: string; amount_cents: number; type: 'depense' | 'recette'; piece: string; descr: string; cat: string; cnt: number }>(groupId);

  const groups: DedupGroup[] = [];
  let totalDuplicates = 0;
  let totalDeletable = 0;
  let totalKeptDespite = 0;

  for (const k of dupKeys) {
    const rows = await db
      .prepare(
        `SELECT e.id, e.date_ecriture, e.amount_cents, e.type, e.description,
                e.numero_piece, e.unite_id, u.name as unite_name,
                e.category_id, c.name as category_name,
                e.mode_paiement_id, e.activite_id, e.notes
         FROM ecritures e
         LEFT JOIN unites u ON u.id = e.unite_id
         LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.group_id = ? AND e.status = 'saisie_comptaweb'
           AND e.date_ecriture = ? AND e.amount_cents = ? AND e.type = ?
           AND COALESCE(e.numero_piece, '') = ?
           AND COALESCE(e.description, '') = ?
           AND COALESCE(e.category_id, '') = ?`,
      )
      .all<EcritureRow>(groupId, k.date_ecriture, k.amount_cents, k.type, k.piece, k.descr, k.cat);

    // Pour chaque écriture, vérifier si elle a un lien externe.
    const candidates: DedupCandidate[] = [];
    for (const r of rows) {
      const justifCount = await db
        .prepare(
          `SELECT COUNT(*) as n FROM justificatifs
           WHERE entity_type = 'ecriture' AND entity_id = ?`,
        )
        .get<{ n: number }>(r.id);
      const depotCount = await db
        .prepare(
          `SELECT COUNT(*) as n FROM depots_justificatifs WHERE ecriture_id = ?`,
        )
        .get<{ n: number }>(r.id);
      const rembCount = await db
        .prepare(
          `SELECT COUNT(*) as n FROM remboursements WHERE ecriture_id = ?`,
        )
        .get<{ n: number }>(r.id);
      const hasLinks = (justifCount?.n ?? 0) + (depotCount?.n ?? 0) + (rembCount?.n ?? 0) > 0;
      candidates.push({
        id: r.id,
        description: r.description,
        numero_piece: r.numero_piece,
        unite_id: r.unite_id,
        unite_name: r.unite_name,
        category_id: r.category_id,
        category_name: r.category_name,
        notes: r.notes,
        has_links: hasLinks,
        score: scoreEcriture(r),
      });
    }

    // Trie par score DESC, à égalité préférer celui qui a des liens.
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.has_links !== b.has_links) return a.has_links ? -1 : 1;
      return 0;
    });

    const keepId = candidates[0].id;
    const others = candidates.slice(1);
    const toDeleteIds = others.filter((c) => !c.has_links).map((c) => c.id);
    const toKeepDespiteIds = others.filter((c) => c.has_links).map((c) => c.id);

    totalDuplicates += others.length;
    totalDeletable += toDeleteIds.length;
    totalKeptDespite += toKeepDespiteIds.length;

    groups.push({
      date: k.date_ecriture,
      amount_cents: k.amount_cents,
      type: k.type,
      candidates,
      keepId,
      toDeleteIds,
      toKeepDespiteIds,
    });
  }

  return { groups, totalDuplicates, totalDeletable, totalKeptDespite };
}

export interface DedupExecResult {
  deleted: number;
  skipped: number;
}

// Supprime UNIQUEMENT les écritures listées comme "toDeleteIds" dans le
// rapport. Re-vérifie l'absence de liens externes au moment du DELETE
// pour éviter une race condition (justif uploadé entre la détection
// et l'exécution).
export async function deleteCsvDuplicates(
  { groupId }: { groupId: string },
  ids: string[],
): Promise<DedupExecResult> {
  if (ids.length === 0) return { deleted: 0, skipped: 0 };
  const db = getDb();
  let deleted = 0;
  let skipped = 0;
  for (const id of ids) {
    // Re-check : si entre temps un justif/dépôt/remb a été rattaché,
    // on skip cette suppression.
    const justifs = await db
      .prepare(
        `SELECT COUNT(*) as n FROM justificatifs
         WHERE entity_type = 'ecriture' AND entity_id = ?`,
      )
      .get<{ n: number }>(id);
    const depots = await db
      .prepare(`SELECT COUNT(*) as n FROM depots_justificatifs WHERE ecriture_id = ?`)
      .get<{ n: number }>(id);
    const rembs = await db
      .prepare(`SELECT COUNT(*) as n FROM remboursements WHERE ecriture_id = ?`)
      .get<{ n: number }>(id);
    if ((justifs?.n ?? 0) + (depots?.n ?? 0) + (rembs?.n ?? 0) > 0) {
      skipped++;
      continue;
    }
    // Vérifier aussi que c'est bien dans le groupe + status saisie_comptaweb
    // (sécurité : on ne supprime que les écritures du CSV, jamais une
    // écriture brouillon ou validée).
    const ok = await db
      .prepare(
        `SELECT 1 FROM ecritures
         WHERE id = ? AND group_id = ? AND status = 'saisie_comptaweb'`,
      )
      .get<{ '1': number }>(id, groupId);
    if (!ok) {
      skipped++;
      continue;
    }
    await db.prepare('DELETE FROM ecritures WHERE id = ?').run(id);
    deleted++;
  }
  return { deleted, skipped };
}

// ============================================================================
// Cleanup des orphelins cat=null générés par d'anciens imports buggés.
//
// Contexte : avant le fix mapping comptaweb_nature, certaines ventilations
// CSV n'étaient pas mappées à la bonne catégorie (ex. "Participation au
// Fct du Mouvement" → fuzzy fail → category_id=null). Du coup findExact
// ne matchait pas l'écriture précédente (qui avait cat correct via mapping
// fuzzy plus chanceux à un autre import) → INSERT en doublon avec cat=null.
//
// Détection : pour chaque écriture saisie_comptaweb avec category_id=null,
// chercher une "twin" (mêmes date, amount, type, piece, description) qui a
// category_id défini. Si une twin existe → l'orphelin est un doublon de
// la twin (créé par un import qui a raté le mapping de catégorie). Sinon
// l'orphelin est légitime, juste à compléter à la main.
//
// BUG ÉVITÉ (incident 2026-05-05) : un même tuple (date, piece, description)
// peut héberger plusieurs ventilations distinctes à même montant mais
// catégories différentes (ex. "Inscriptions cash 423€" ESP-2501 27/09 a
// 7 ventilations dont Cotisations 20€ ET Dons 20€). Si l'une devient
// orpheline cat=null, l'autre apparaît comme "twin" alors qu'elles sont
// distinctes — supprimer l'orphelin perdrait une vraie ventilation.
//
// Garde-fou : on regarde combien d'écritures partagent (date, piece,
// description) avec l'orphelin (toutes catégories). Si > 2, c'est un
// cas multi-ventilations — on classe l'orphelin "à compléter à la main",
// pas en doublon. Seuls les cas "exactement 2 écritures (1 twin + 1
// orphelin)" sont proposés en suppression — là c'est un vrai doublon
// issu d'un re-import buggé.
// ============================================================================

export interface OrphanCandidate {
  id: string;
  date_ecriture: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  description: string | null;
  numero_piece: string | null;
  notes: string | null;
  twin_id: string | null;
  twin_category_name: string | null;
  has_links: boolean;
}

export interface OrphanReport {
  withTwin: OrphanCandidate[]; // peuvent être supprimés (doublons d'une twin)
  withoutTwin: OrphanCandidate[]; // légitimes, à compléter à la main
  totalDeletable: number;
  totalNeedsCompletion: number;
}

export async function findOrphansWithoutCategory(
  { groupId }: { groupId: string },
): Promise<OrphanReport> {
  const db = getDb();
  const orphans = await db
    .prepare(
      `SELECT id, date_ecriture, amount_cents, type, description, numero_piece, notes
       FROM ecritures
       WHERE group_id = ? AND status = 'saisie_comptaweb'
         AND category_id IS NULL
       ORDER BY date_ecriture DESC`,
    )
    .all<{
      id: string; date_ecriture: string; amount_cents: number;
      type: 'depense' | 'recette'; description: string | null;
      numero_piece: string | null; notes: string | null;
    }>(groupId);

  const withTwin: OrphanCandidate[] = [];
  const withoutTwin: OrphanCandidate[] = [];

  for (const o of orphans) {
    // Twin candidate : autre écriture à mêmes (date, amount, type, piece,
    // description) avec catégorie définie.
    const twin = await db
      .prepare(
        `SELECT e.id, c.name as cat_name
         FROM ecritures e
         LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.group_id = ? AND e.status = 'saisie_comptaweb'
           AND e.id != ?
           AND e.date_ecriture = ? AND e.amount_cents = ? AND e.type = ?
           AND COALESCE(e.numero_piece, '') = COALESCE(?, '')
           AND COALESCE(e.description, '') = COALESCE(?, '')
           AND e.category_id IS NOT NULL
         LIMIT 1`,
      )
      .get<{ id: string; cat_name: string | null }>(
        groupId, o.id, o.date_ecriture, o.amount_cents, o.type,
        o.numero_piece, o.description,
      );

    // Garde-fou multi-ventilations : combien d'écritures partagent le
    // même (date, piece, description) — toutes catégories et montants
    // confondus ? Si > 2, c'est un regroupement avec plusieurs
    // ventilations distinctes. L'orphelin pourrait être l'une d'elles,
    // pas un doublon. On classe en "à compléter à la main".
    const sameRegroupement = await db
      .prepare(
        `SELECT COUNT(*) as n FROM ecritures
         WHERE group_id = ? AND status = 'saisie_comptaweb'
           AND date_ecriture = ?
           AND COALESCE(numero_piece, '') = COALESCE(?, '')
           AND COALESCE(description, '') = COALESCE(?, '')`,
      )
      .get<{ n: number }>(groupId, o.date_ecriture, o.numero_piece, o.description);
    const regroupementSize = sameRegroupement?.n ?? 0;

    const justifs = await db
      .prepare(`SELECT COUNT(*) as n FROM justificatifs WHERE entity_type='ecriture' AND entity_id=?`)
      .get<{ n: number }>(o.id);
    const depots = await db
      .prepare(`SELECT COUNT(*) as n FROM depots_justificatifs WHERE ecriture_id=?`)
      .get<{ n: number }>(o.id);
    const rembs = await db
      .prepare(`SELECT COUNT(*) as n FROM remboursements WHERE ecriture_id=?`)
      .get<{ n: number }>(o.id);
    const has_links = (justifs?.n ?? 0) + (depots?.n ?? 0) + (rembs?.n ?? 0) > 0;

    const candidate: OrphanCandidate = {
      ...o,
      twin_id: twin?.id ?? null,
      twin_category_name: twin?.cat_name ?? null,
      has_links,
    };
    // Suppression sûre seulement si :
    // - twin existe avec catégorie définie
    // - aucun lien externe
    // - exactement 2 écritures partagent (date, piece, description) :
    //   la twin + l'orphelin (= cas simple "vrai doublon", pas
    //   multi-ventilations)
    if (twin && !has_links && regroupementSize === 2) withTwin.push(candidate);
    else withoutTwin.push(candidate);
  }

  return {
    withTwin,
    withoutTwin,
    totalDeletable: withTwin.length,
    totalNeedsCompletion: withoutTwin.length,
  };
}

export async function deleteOrphansWithoutCategory(
  { groupId }: { groupId: string },
  ids: string[],
): Promise<DedupExecResult> {
  // Réutilise la même logique que deleteCsvDuplicates (re-check liens
  // externes + status saisie_comptaweb) — sécurité identique.
  return deleteCsvDuplicates({ groupId }, ids);
}
