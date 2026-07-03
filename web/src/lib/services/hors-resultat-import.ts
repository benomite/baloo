import type { DbWrapper } from '../db';
import { nextId, currentTimestamp } from '../ids';

// Catégorie « hors résultat » (flux inter-structures) : exclut l'écriture du
// résultat et des budgets (cf. CATEGORIES_HORS_RESULTAT dans overview.ts) tout
// en la gardant dans la trésorerie. Existe en base (comptaweb_id 94).
const CAT_FLUX_STRUCTURES = 'cat-flux-structures';
// Même tolérance que le match contenu du reconcile (drafts.ts / sync-cycle.ts).
const DATE_TOLERANCE_DAYS = 3;

export interface TransferInput {
  cwId: number;
  dateEcriture: string; // ISO YYYY-MM-DD
  montantCentimes: number; // signé (négatif = dépense)
  intitule: string;
}

export interface ImportTransfersResult {
  promoted: number;
  created: number;
  skipped: number;
}

/**
 * Importe les transferts inter-structures (Echelon National) déjà comptabilisés
 * dans Comptaweb mais absents du journal `/recettedepense`, comme lignes
 * VALIDÉES (mirror) dans Baloo. Pour chaque transfert :
 *   1. déjà mirroré (par contenu) → skip (l'id du rapprochement ≠ id du journal,
 *      donc dédup par contenu, jamais par id) ;
 *   2. un seul draft matchant → promotion en ligne validée (adopte le titre CW) ;
 *   3. sinon → création directe d'une ligne validée.
 * Ne supprime jamais rien (règle CLAUDE.md). Marque `cat-flux-structures` →
 * hors résultat + exclusion de la détection « supprimée dans CW » du reconcile.
 */
export async function importHorsResultatTransfers(
  db: DbWrapper,
  { groupId }: { groupId: string },
  transfers: TransferInput[],
): Promise<ImportTransfersResult> {
  let promoted = 0;
  let created = 0;
  let skipped = 0;

  for (const t of transfers) {
    const type = t.montantCentimes < 0 ? 'depense' : 'recette';
    const amountAbs = Math.abs(t.montantCentimes);

    // 1. Déjà mirrorée (par CONTENU : montant + type + date proche).
    const existing = await db
      .prepare(
        `SELECT id FROM ecritures
          WHERE group_id = ? AND status IN ('mirror','pending_sync','pending_cw','divergent')
            AND amount_cents = ? AND type = ?
            AND ABS(julianday(date_ecriture) - julianday(?)) <= ?
          LIMIT 1`,
      )
      .get<{ id: string }>(groupId, amountAbs, type, t.dateEcriture, DATE_TOLERANCE_DAYS);
    if (existing) { skipped++; continue; }

    const now = currentTimestamp();

    // 2. Un SEUL draft matchant → promotion en ligne validée.
    const drafts = await db
      .prepare(
        `SELECT id FROM ecritures
          WHERE group_id = ? AND status = 'draft' AND comptaweb_ecriture_id IS NULL
            AND amount_cents = ? AND type = ?
            AND ABS(julianday(date_ecriture) - julianday(?)) <= ?`,
      )
      .all<{ id: string }>(groupId, amountAbs, type, t.dateEcriture, DATE_TOLERANCE_DAYS);

    if (drafts.length === 1) {
      await db
        .prepare(
          `UPDATE ecritures SET status = 'mirror', comptaweb_synced = 1,
             comptaweb_ecriture_id = ?, description = ?, category_id = ?,
             justif_attendu = 0, updated_at = ?
           WHERE id = ? AND group_id = ?`,
        )
        .run(t.cwId, t.intitule, CAT_FLUX_STRUCTURES, now, drafts[0].id, groupId);
      promoted++;
      continue;
    }

    // 3. Sinon (0 draft, ou ≥2 = ambigu : on ne touche pas les drafts) →
    //    création directe. Garantit qu'au bout du compte la ligne validée existe.
    const id = await nextId('ECR');
    await db
      .prepare(
        `INSERT INTO ecritures
           (id, group_id, date_ecriture, description, amount_cents, type,
            category_id, status, comptaweb_synced, comptaweb_ecriture_id,
            justif_attendu, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'mirror', 1, ?, 0, ?, ?)`,
      )
      .run(id, groupId, t.dateEcriture, t.intitule, amountAbs, type, CAT_FLUX_STRUCTURES, t.cwId, now, now);
    created++;
  }

  return { promoted, created, skipped };
}
