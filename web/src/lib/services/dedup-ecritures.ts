// Détection et suppression des écritures doublons générées par les
// imports CSV Comptaweb successifs. Avant le fix UPSERT (commit 8a72f43),
// les imports faisaient DELETE+INSERT ; et même après, le matching par
// (group, date, amount, type, piece) pouvait rater quand piece ou
// description avaient changé entre 2 imports — produisant des doublons
// "vides" (sans description, sans imputation) qui se cumulent aux
// écritures complètes.
//
// Stratégie :
// 1. Grouper par (group, date, amount, type) — clé naturelle d'une ligne
//    bancaire. À l'intérieur de chaque groupe, plusieurs lignes = doublons.
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
  unite_id: string | null;
  category_id: string | null;
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
  unite_id: string | null;
  category_id: string | null;
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
      `SELECT date_ecriture, amount_cents, type, COUNT(*) as cnt
       FROM ecritures
       WHERE group_id = ? AND status = 'saisie_comptaweb'
       GROUP BY date_ecriture, amount_cents, type
       HAVING cnt > 1
       ORDER BY date_ecriture DESC`,
    )
    .all<{ date_ecriture: string; amount_cents: number; type: 'depense' | 'recette'; cnt: number }>(groupId);

  const groups: DedupGroup[] = [];
  let totalDuplicates = 0;
  let totalDeletable = 0;
  let totalKeptDespite = 0;

  for (const k of dupKeys) {
    const rows = await db
      .prepare(
        `SELECT id, date_ecriture, amount_cents, type, description, unite_id,
                category_id, mode_paiement_id, activite_id, notes
         FROM ecritures
         WHERE group_id = ? AND status = 'saisie_comptaweb'
           AND date_ecriture = ? AND amount_cents = ? AND type = ?`,
      )
      .all<EcritureRow>(groupId, k.date_ecriture, k.amount_cents, k.type);

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
        unite_id: r.unite_id,
        category_id: r.category_id,
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
