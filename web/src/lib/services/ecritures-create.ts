// Service `createEcritureAndPushToCw` — flux miroir strict de création
// d'une écriture comptable (Task 7 du pivot phase 1).
//
// Doctrine (cf. doc/specs/2026-05-18-baloo-miroir-mcp-first-design.md
// "Principe central : miroir strict") :
//
//   1. INSERT en BDD Baloo avec status='pending_cw' (snapshot du payload,
//      l'écriture n'existe pas encore dans CW).
//   2. Appel scraper CW pour créer l'écriture dans Comptaweb.
//   3a. Succès : UPDATE status='pending_sync', store cw_numero_piece.
//       La sync incrémentale (Phase 2) promouvra plus tard en 'mirror'
//       quand elle retrouvera l'écriture dans la liste CW.
//   3b. Échec  : UPDATE status='draft', propagation de l'erreur au caller.
//       Pas de DELETE (cf. CLAUDE.md "JAMAIS de DELETE") : l'écriture
//       reste en BDD, l'user peut la voir dans /inbox et la reprendre,
//       réessayer le push, ou copier-coller manuellement dans CW.
//
// Hors scope Task 7 :
//   - Mapping Baloo → référentiels CW (category_id → natureId, etc.) :
//     vit dans l'adapter scraper qui sera construit en Task 8 (refonte UI
//     saisie). Pour cette task, on injecte le scraper et on teste juste
//     le flow status.
//   - Promotion pending_sync → mirror via sync incrémentale : Phase 2.

import type { DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';
import type { ComptawebConfig } from '../comptaweb/types';

// Payload "Baloo-friendly" : monnaie en cents, IDs Baloo (catégorie,
// mode paiement, unité, activité, carte). Le scraper se charge de la
// traduction vers les IDs Comptaweb (Task 8).
export interface EcriturePayload {
  date_ecriture: string; // ISO YYYY-MM-DD
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  category_id?: string | null;
  mode_paiement_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  carte_id?: string | null;
  numero_piece?: string | null;
  notes?: string | null;
  justif_attendu?: 0 | 1 | boolean;
}

// Résultat du scraper CW : le numéro de pièce que CW retournera dans ses
// listings (sert de clé de matching pour la sync Phase 2), et optionnel
// l'ID interne CW (utile en debug / pour pointer une URL CW).
export interface CwScraperResult {
  cwNumeroPiece: string;
  cwEcritureId?: number;
}

// Signature volontairement adaptée à Baloo (pas la signature brute de
// `comptaweb/ecritures-write.createEcriture` qui prend des IDs CW déjà
// résolus). Une implémentation concrète passera par
// `fetchReferentielsCreer` + résolution des IDs + appel `createEcriture`.
// Pour Task 7, le scraper est passé en injection ; l'adapter complet
// est livré en Task 8.
export type CwScraper = (
  config: ComptawebConfig,
  payload: EcriturePayload,
) => Promise<CwScraperResult>;

export interface CreateEcritureAndPushToCwResult {
  id: string;
  status: 'pending_sync' | 'draft';
  cw_numero_piece: string | null;
}

export interface CreateEcritureAndPushToCwOpts {
  payload: EcriturePayload;
  group_id: string;
  /** Injectable pour les tests. En prod : adapter Comptaweb (Task 8). */
  cwScraper?: CwScraper;
  /** Injectable pour les tests. En prod : `loadConfig()` Comptaweb. */
  cwConfigLoader?: () => Promise<ComptawebConfig>;
}

/**
 * Crée une écriture en BDD Baloo puis la pousse vers Comptaweb.
 *
 * Concurrence : pas de retry magique en cas d'échec. Le caller relance
 * lui-même si voulu (créant ainsi une nouvelle écriture distincte).
 */
export async function createEcritureAndPushToCw(
  db: DbWrapper,
  opts: CreateEcritureAndPushToCwOpts,
): Promise<CreateEcritureAndPushToCwResult> {
  const { payload, group_id } = opts;
  const prefix = payload.type === 'depense' ? 'DEP' : 'REC';
  const id = await nextIdOn(db, prefix);
  const now = currentTimestamp();
  const justifAttendu = payload.justif_attendu === undefined
    ? 1
    : (payload.justif_attendu ? 1 : 0);

  // 1. INSERT en `pending_cw` : snapshot du payload, l'écriture est en
  //    cours d'envoi vers CW. Si le process meurt à ce point, on aura un
  //    `pending_cw` orphelin — repérable et relançable manuellement.
  await db
    .prepare(
      `INSERT INTO ecritures (
        id, group_id, date_ecriture, description, amount_cents, type,
        unite_id, category_id, mode_paiement_id, activite_id, numero_piece,
        carte_id, justif_attendu, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_cw', ?, ?)`,
    )
    .run(
      id,
      group_id,
      payload.date_ecriture,
      payload.description,
      payload.amount_cents,
      payload.type,
      nullIfEmpty(payload.unite_id ?? null),
      nullIfEmpty(payload.category_id ?? null),
      nullIfEmpty(payload.mode_paiement_id ?? null),
      nullIfEmpty(payload.activite_id ?? null),
      nullIfEmpty(payload.numero_piece ?? null),
      nullIfEmpty(payload.carte_id ?? null),
      justifAttendu,
      nullIfEmpty(payload.notes ?? null),
      now,
      now,
    );

  // 2. Push CW. Le scraper et le loader sont injectables pour les tests.
  // En prod (Task 8), on injectera l'adapter Comptaweb réel.
  if (!opts.cwScraper) {
    // Garde-fou Task 7 : pas d'adapter réel encore branché (Task 8).
    // On évite de laisser un `pending_cw` orphelin si on est appelé sans
    // injection : rétrograde en `draft` immédiatement et propage.
    await rollbackToDraft(db, id);
    throw new Error(
      'createEcritureAndPushToCw: cwScraper non fourni (adapter Comptaweb pas encore branché — Task 8).',
    );
  }
  if (!opts.cwConfigLoader) {
    await rollbackToDraft(db, id);
    throw new Error('createEcritureAndPushToCw: cwConfigLoader non fourni.');
  }

  try {
    const config = await opts.cwConfigLoader();
    const cwResult = await opts.cwScraper(config, payload);

    // 3a. Succès : UPDATE status='pending_sync', store cw_numero_piece
    // (+ comptaweb_ecriture_id si fourni). On NE flip PAS
    // comptaweb_synced à 1 : ce flag passe à 1 uniquement à la promotion
    // `mirror` par la sync incrémentale (Phase 2).
    await db
      .prepare(
        `UPDATE ecritures
           SET status = 'pending_sync',
               cw_numero_piece = ?,
               comptaweb_ecriture_id = COALESCE(?, comptaweb_ecriture_id),
               updated_at = ?
         WHERE id = ? AND group_id = ?`,
      )
      .run(
        cwResult.cwNumeroPiece,
        cwResult.cwEcritureId ?? null,
        currentTimestamp(),
        id,
        group_id,
      );

    return {
      id,
      status: 'pending_sync',
      cw_numero_piece: cwResult.cwNumeroPiece,
    };
  } catch (err) {
    // 3b. Échec : UPDATE status='draft' (PAS DE DELETE — règle CLAUDE.md).
    // L'écriture reste en BDD avec son snapshot, visible dans /inbox.
    // L'user peut la reprendre, réessayer le push, ou copier-coller dans CW.
    await rollbackToDraft(db, id);
    throw err;
  }
}

async function rollbackToDraft(db: DbWrapper, id: string): Promise<void> {
  await db
    .prepare(
      `UPDATE ecritures SET status = 'draft', updated_at = ? WHERE id = ?`,
    )
    .run(currentTimestamp(), id);
}
