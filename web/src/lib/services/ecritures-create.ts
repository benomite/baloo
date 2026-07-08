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
//   3b. Échec CW : UPDATE status='draft', throw `CwPushFailedError`
//       (porteur de l'ecriture_id) — caller utilise cet id directement
//       pour rediriger vers /inbox.
//       Pas de DELETE (cf. CLAUDE.md "JAMAIS de DELETE").
//   3c. CW OK mais UPDATE local KO : état grave (CW a la donnée, Baloo
//       dit `pending_cw`). Throw `CwLocalUpdateFailedError` (porteur du
//       cw_numero_piece) pour que le caller route un 500 explicite.
//       La sync Phase 2 ramassera l'écriture par cw_numero_piece et
//       complétera l'état local — mais en attendant Baloo est désynchro.
//
// Hors scope Task 7 :
//   - Mapping Baloo → référentiels CW (category_id → natureId, etc.) :
//     vit dans l'adapter scraper qui sera construit en Task 8 (refonte UI
//     saisie). Pour cette task, on injecte le scraper et on teste juste
//     le flow status.
//   - Promotion pending_sync → mirror via sync incrémentale : Phase 2.

import { randomUUID } from 'node:crypto';
import type { DbWrapper } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { nullIfEmpty } from '../utils/form';
import type { ComptawebConfig } from '../comptaweb/types';

// Erreur dédiée pour l'échec du push CW (scraper rejette ou
// `cwConfigLoader` plante). Porte l'`ecritureId` du draft rétrogradé
// pour que le caller redirige sans avoir à faire une requête
// non-déterministe (race condition entre POST concurrents).
export class CwPushFailedError extends Error {
  constructor(
    public readonly ecritureId: string,
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CwPushFailedError';
  }
}

// Erreur dédiée pour le cas où le scraper CW a réussi mais l'UPDATE local
// `pending_sync` plante. État grave : CW a la donnée (avec
// `cw_numero_piece`), Baloo l'a en `pending_cw`. Re-pusher créerait un
// doublon CW. Caller doit logger et signaler à l'utilisateur — la sync
// incrémentale Phase 2 finira par retrouver l'écriture via
// `cw_numero_piece` et la promouvoir, mais en attendant Baloo est
// désynchronisé.
export class CwLocalUpdateFailedError extends Error {
  constructor(
    public readonly ecritureId: string,
    public readonly cwNumeroPiece: string,
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CwLocalUpdateFailedError';
  }
}

// Une ventilation = une ligne d'imputation (catégorie/unité/activité +
// sa part du montant total). Grain canonique d'une écriture Baloo (cf.
// AGENTS.md "Grain canonique d'une écriture Baloo = la VENTILATION").
export interface VentilationInput {
  amount_cents: number;
  category_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
}

// Payload "Baloo-friendly" : monnaie en cents, IDs Baloo (catégorie,
// mode paiement, unité, activité, carte). Le scraper se charge de la
// traduction vers les IDs Comptaweb (Task 8). Multi-ventilation (S0,
// 2026-07-08) : l'imputation (catégorie/unité/activité) vit désormais
// par ventilation, pas au niveau racine. `amount_cents` racine reste le
// TOTAL et doit être égal à la somme des `ventilations[].amount_cents`
// (invariant validé côté service, adapter CW et route Zod).
export interface EcriturePayload {
  date_ecriture: string; // ISO YYYY-MM-DD
  description: string;
  amount_cents: number; // TOTAL (= Σ ventilations)
  type: 'depense' | 'recette';
  mode_paiement_id?: string | null;
  numero_piece?: string | null;
  carte_id?: string | null;
  notes?: string | null;
  justif_attendu?: 0 | 1 | boolean;
  ventilations: VentilationInput[];
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
  const now = currentTimestamp();
  // Défaut selon le type : une recette (entrée d'argent) n'attend pas de
  // justificatif ; une dépense, si.
  const justifAttendu = payload.justif_attendu === undefined
    ? (payload.type === 'recette' ? 0 : 1)
    : (payload.justif_attendu ? 1 : 0);

  const vents = payload.ventilations;
  if (!vents || vents.length === 0) {
    throw new Error('Au moins une ventilation est requise.');
  }
  const sum = vents.reduce((s, v) => s + v.amount_cents, 0);
  if (sum !== payload.amount_cents) {
    throw new Error(`Somme des ventilations ≠ montant total (${sum} vs ${payload.amount_cents}).`);
  }

  // Group id local UNIQUEMENT si ≥ 2 ventilations : mono-catégorie
  // (1 ventilation) → comportement inchangé, `ventilation_group_id` null.
  const groupId = vents.length >= 2 ? `vg_${randomUUID()}` : null;

  // 1. N INSERT en `pending_cw`, une ligne par ventilation, toutes
  //    partageant `ventilation_group_id`. Si le process meurt à ce
  //    point, on aura des `pending_cw` orphelins — repérables et
  //    relançables manuellement. Si un INSERT throw, on laisse l'erreur
  //    remonter brute (les lignes déjà insérées restent en `pending_cw`,
  //    pas de rollback partiel nécessaire pour ce cas rarissime — pas de
  //    DELETE possible de toute façon, cf. CLAUDE.md).
  const ids: string[] = [];
  for (const v of vents) {
    const id = await nextIdOn(db, prefix);
    ids.push(id);
    await db
      .prepare(
        `INSERT INTO ecritures (
          id, group_id, date_ecriture, description, amount_cents, type,
          unite_id, category_id, mode_paiement_id, activite_id, numero_piece,
          carte_id, justif_attendu, notes, ventilation_group_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_cw', ?, ?)`,
      )
      .run(
        id,
        group_id,
        payload.date_ecriture,
        payload.description,
        v.amount_cents,
        payload.type,
        nullIfEmpty(v.unite_id ?? null),
        nullIfEmpty(v.category_id ?? null),
        nullIfEmpty(payload.mode_paiement_id ?? null),
        nullIfEmpty(v.activite_id ?? null),
        nullIfEmpty(payload.numero_piece ?? null),
        nullIfEmpty(payload.carte_id ?? null),
        justifAttendu,
        nullIfEmpty(payload.notes ?? null),
        groupId,
        now,
        now,
      );
  }
  const firstId = ids[0];

  // 2. Push CW. Le scraper et le loader sont injectables pour les tests.
  // En prod (Task 8), on injectera l'adapter Comptaweb réel.
  // TODO Task 8 : retirer ces deux garde-fous quand l'adapter (scraper +
  // loader) sera toujours fourni par défaut côté route. En attendant, on
  // évite de laisser des `pending_cw` orphelins si on est appelé sans
  // injection : rétrograde le groupe en `draft` immédiatement et throw
  // une `CwPushFailedError` typée pour que le caller reroute proprement.
  if (!opts.cwScraper) {
    await rollbackGroupToDraft(db, ids, group_id);
    throw new CwPushFailedError(
      firstId,
      new Error(
        'createEcritureAndPushToCw: cwScraper non fourni (adapter Comptaweb pas encore branché — Task 8).',
      ),
    );
  }
  if (!opts.cwConfigLoader) {
    await rollbackGroupToDraft(db, ids, group_id);
    throw new CwPushFailedError(
      firstId,
      new Error('createEcritureAndPushToCw: cwConfigLoader non fourni.'),
    );
  }

  // 2bis. Charger la config et appeler le scraper (un seul POST CW,
  // multi-ventilation gérée côté adapter). SEUL ce bloc justifie le
  // rollback `draft` : tant qu'on n'a pas la preuve que CW a accepté la
  // donnée, on peut rétrograder sans risque de doublon. Si CW accepte
  // (étape 3 ci-dessous), un échec local NE DOIT PAS rétrograder.
  let cwResult: CwScraperResult;
  try {
    const config = await opts.cwConfigLoader();
    cwResult = await opts.cwScraper(config, payload);
  } catch (err) {
    // 3b. CW a planté ou refusé : UPDATE status='draft' sur les N lignes
    // (PAS DE DELETE — règle CLAUDE.md). Les écritures restent en BDD
    // avec leur snapshot, visibles dans /inbox. L'user peut les
    // reprendre, réessayer le push, ou copier-coller dans CW. On throw
    // une `CwPushFailedError` portant l'`id` de la 1ʳᵉ ligne du groupe
    // (évite au caller une requête non-déterministe pour la retrouver —
    // race condition entre POST concurrents).
    await rollbackGroupToDraft(db, ids, group_id);
    throw new CwPushFailedError(firstId, err);
  }

  // 3a. Succès CW : UPDATE status='pending_sync' sur les N lignes, store
  // cw_numero_piece (+ comptaweb_ecriture_id si fourni) — le MÊME
  // cw_numero_piece pour toutes les ventilations du groupe (un seul
  // enregistrement CW). On NE flip PAS comptaweb_synced à 1 : ce flag
  // passe à 1 uniquement à la promotion `mirror` par la sync
  // incrémentale (Phase 2).
  //
  // 3c. Si cet UPDATE local plante alors que CW a déjà la donnée, on est
  // dans un état grave : rétrocéder en `draft` mènerait à un doublon CW
  // au prochain retry de l'user. On laisse `pending_cw` et on throw une
  // `CwLocalUpdateFailedError` explicite porteuse du cw_numero_piece.
  // La sync Phase 2 finira par retrouver l'écriture par cw_numero_piece.
  try {
    for (const id of ids) {
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
    }
  } catch (err) {
    console.error('[ecritures-create] CW push OK but local UPDATE failed', {
      ecriture_ids: ids,
      cw_numero_piece: cwResult.cwNumeroPiece,
      error: err,
    });
    throw new CwLocalUpdateFailedError(firstId, cwResult.cwNumeroPiece, err);
  }

  return {
    id: firstId,
    status: 'pending_sync',
    cw_numero_piece: cwResult.cwNumeroPiece,
  };
}

// Rétrograde toutes les lignes d'un groupe (1 seule si mono-ventilation)
// en `draft`. Scopé `group_id` par symétrie avec l'UPDATE succès et
// défense en profondeur si jamais un mauvais `id` était passé par
// erreur — même si en pratique les `ids` sont générés localement juste
// avant et appartiennent au `group_id` courant.
async function rollbackGroupToDraft(
  db: DbWrapper,
  ids: string[],
  group_id: string,
): Promise<void> {
  for (const id of ids) {
    await db
      .prepare(
        `UPDATE ecritures SET status = 'draft', updated_at = ?
          WHERE id = ? AND group_id = ?`,
      )
      .run(currentTimestamp(), id, group_id);
  }
}
