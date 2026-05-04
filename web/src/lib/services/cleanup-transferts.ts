// Détection et suppression des "transferts internes" mal importés.
//
// Contexte : avant le fix encoding (commit 4a19d70), le parser CSV lisait
// "D�pense" au lieu de "Dépense" → row['Dépense'] = undefined → depCents
// = 0. Conséquence : les lignes Comptaweb de type "Dépot monnaie" (caisse
// → banque) qui ont Dépense=Recette=X étaient lues comme depV=0,
// recV=X → pas skippées comme transferts internes mais INSERTées comme
// recettes faussement (avec category_id NULL souvent).
//
// Ces écritures faussent la synthèse et ne correspondent à AUCUNE
// recette réelle. Elles doivent être supprimées.
//
// Détection : intitulé qui matche "Dépot monnaie", "Dépôt billet",
// "Dépôt espèces" (variantes avec/sans accent corrompu) OU description
// contient "Dépôts, retrait espèces" (la catégorie Comptaweb).
// Filtre de sécurité : status='saisie_comptaweb' (jamais des saisies
// manuelles), aucun lien externe (justif/dépôt/remb).

import { getDb } from '../db';

export interface TransfertCandidate {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  category_name: string | null;
  has_links: boolean;
}

export interface CleanupReport {
  candidates: TransfertCandidate[];
  totalDeletable: number;
  totalKeptDespite: number;
  totalAmount: number;
}

const PATTERNS = [
  /d[eé�]p[oô�]t\s+(monnaie|billet|esp[eé�]ces|cheques?)/i,
  /d[eé�]pot\s+(monnaie|billet|esp[eé�]ces|cheques?)/i,
];

function isTransfert(description: string): boolean {
  if (!description) return false;
  return PATTERNS.some((p) => p.test(description));
}

export async function findInternalTransfers(
  { groupId }: { groupId: string },
): Promise<CleanupReport> {
  const db = getDb();
  const rows = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type,
              c.name as category_name
       FROM ecritures e
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.group_id = ? AND e.status = 'saisie_comptaweb'`,
    )
    .all<{
      id: string;
      date_ecriture: string;
      description: string;
      amount_cents: number;
      type: 'depense' | 'recette';
      category_name: string | null;
    }>(groupId);

  const candidates: TransfertCandidate[] = [];
  for (const r of rows) {
    if (!isTransfert(r.description)) continue;
    // Vérifie absence de liens externes
    const justifs = await db
      .prepare(
        `SELECT COUNT(*) as n FROM justificatifs WHERE entity_type='ecriture' AND entity_id=?`,
      )
      .get<{ n: number }>(r.id);
    const depots = await db
      .prepare(`SELECT COUNT(*) as n FROM depots_justificatifs WHERE ecriture_id=?`)
      .get<{ n: number }>(r.id);
    const rembs = await db
      .prepare(`SELECT COUNT(*) as n FROM remboursements WHERE ecriture_id=?`)
      .get<{ n: number }>(r.id);
    const hasLinks = (justifs?.n ?? 0) + (depots?.n ?? 0) + (rembs?.n ?? 0) > 0;
    candidates.push({ ...r, has_links: hasLinks });
  }

  const deletable = candidates.filter((c) => !c.has_links);
  const totalAmount = deletable.reduce((s, c) => s + c.amount_cents, 0);
  return {
    candidates,
    totalDeletable: deletable.length,
    totalKeptDespite: candidates.length - deletable.length,
    totalAmount,
  };
}

export async function deleteInternalTransfers(
  { groupId }: { groupId: string },
  ids: string[],
): Promise<{ deleted: number; skipped: number }> {
  if (ids.length === 0) return { deleted: 0, skipped: 0 };
  const db = getDb();
  let deleted = 0;
  let skipped = 0;
  for (const id of ids) {
    // Re-check liens (race condition)
    const justifs = await db
      .prepare(
        `SELECT COUNT(*) as n FROM justificatifs WHERE entity_type='ecriture' AND entity_id=?`,
      )
      .get<{ n: number }>(id);
    const depots = await db
      .prepare(`SELECT COUNT(*) as n FROM depots_justificatifs WHERE ecriture_id=?`)
      .get<{ n: number }>(id);
    const rembs = await db
      .prepare(`SELECT COUNT(*) as n FROM remboursements WHERE ecriture_id=?`)
      .get<{ n: number }>(id);
    if ((justifs?.n ?? 0) + (depots?.n ?? 0) + (rembs?.n ?? 0) > 0) {
      skipped++;
      continue;
    }
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
    await db.prepare(`DELETE FROM ecritures WHERE id = ?`).run(id);
    deleted++;
  }
  return { deleted, skipped };
}
