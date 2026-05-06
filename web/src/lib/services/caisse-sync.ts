import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import {
  withAutoReLogin,
  fetchCaisseGestion,
  fetchCaisseList,
  type CaisseGestionData,
  type MouvementCaisseComptaweb,
} from '../comptaweb';
import type { MouvementCaisseStatus, MouvementCaisseType } from '../types';

// Sync caisse Comptaweb → Baloo (ADR à venir).
//
// Stratégie d'upsert pour rester non-destructif (cf. règle "JAMAIS
// DELETE / toujours UPSERT" dans CLAUDE.md / AGENTS.md) :
//
// 1. Match prioritaire par `comptaweb_ecriture_id` — clé d'idempotence
//    forte (donnée par Comptaweb, immuable).
// 2. Sinon fallback : `numero_piece + date + abs(amount)` pour rapprocher
//    les lignes pré-existantes (ex. import Airtable historique) qui
//    n'avaient pas l'id Comptaweb. Évite le doublon au premier sync.
// 3. Sinon insert.
//
// Sur match : on UPDATE seulement les champs Comptaweb (description,
// numero_piece, type, comptaweb_ecriture_id, amount_cents) avec
// `COALESCE(champ_actuel, ?)` pour ne JAMAIS écraser une valeur que
// l'utilisateur a saisie côté Baloo. Le `status` (workflow Baloo) et
// `notes` ne sont jamais touchés par la sync.

export interface CaisseSyncStats {
  pulled: number;
  inserted: number;
  matched_by_cw_id: number;
  matched_by_fallback: number;
  unchanged: number;
}

export interface CaisseSyncResult {
  caisseId: number;
  libelle: string;
  soldeComptaweb: number;
  soldeBaloo: number;
  stats: CaisseSyncStats;
}

function signedAmount(m: MouvementCaisseComptaweb): number {
  // Recette = entrée d'argent (positif). Dépense + transfert (sortie
  // pour dépôt en banque) = négatif.
  return m.type === 'recette' ? m.montantCentimes : -m.montantCentimes;
}

function mapType(m: MouvementCaisseComptaweb): MouvementCaisseType {
  if (m.type === 'recette') return 'entree';
  if (m.type === 'transfert') return 'depot';
  return 'sortie';
}

function inferStatus(m: MouvementCaisseComptaweb): MouvementCaisseStatus {
  // Heuristique conservatrice : un transfert (dépôt en banque) qui a
  // une écriture Comptaweb a au minimum été déposé. On ne peut pas
  // savoir s'il a été rapproché ; le user peut le marquer manuellement.
  if (m.type === 'transfert') return 'depose';
  return 'saisi';
}

export async function syncCaisseFromComptaweb(
  groupId: string,
  caisseId: number,
): Promise<CaisseSyncResult> {
  const data = await withAutoReLogin((config) => fetchCaisseGestion(config, caisseId));
  return persistCaisseSync(groupId, data);
}

// Persiste le résultat de scrape — exposé séparément pour permettre
// un test offline (sans Comptaweb live).
export async function persistCaisseSync(
  groupId: string,
  data: CaisseGestionData,
): Promise<CaisseSyncResult> {
  const db = getDb();
  const stats: CaisseSyncStats = {
    pulled: data.mouvements.length,
    inserted: 0,
    matched_by_cw_id: 0,
    matched_by_fallback: 0,
    unchanged: 0,
  };

  for (const mvt of data.mouvements) {
    const amountSigned = signedAmount(mvt);
    const inferredType = mapType(mvt);
    const inferredStatus = inferStatus(mvt);

    // 1. Match par comptaweb_ecriture_id (clé d'idempotence forte).
    const byCwId = await db
      .prepare(
        `SELECT id, status FROM mouvements_caisse
          WHERE group_id = ? AND comptaweb_ecriture_id = ?`,
      )
      .get<{ id: string; status: string }>(groupId, mvt.comptawebEcritureId);

    if (byCwId) {
      // Refresh des champs Comptaweb. COALESCE pour les champs que le
      // user pourrait avoir enrichis localement, REPLACE pour amount
      // et description (source = Comptaweb).
      await db
        .prepare(
          `UPDATE mouvements_caisse
              SET amount_cents = ?,
                  description  = ?,
                  type         = COALESCE(type, ?),
                  numero_piece = COALESCE(numero_piece, ?)
            WHERE id = ?`,
        )
        .run(amountSigned, mvt.intitule, inferredType, mvt.numeroPiece, byCwId.id);
      stats.matched_by_cw_id++;
      continue;
    }

    // 2. Match fallback : (numero_piece, date, abs(montant)) — pour
    // rattraper les lignes Airtable qui n'ont pas encore d'ID CW.
    const byPiece = mvt.numeroPiece
      ? await db
          .prepare(
            `SELECT id FROM mouvements_caisse
              WHERE group_id = ?
                AND numero_piece = ?
                AND date_mouvement = ?
                AND ABS(amount_cents) = ?
                AND comptaweb_ecriture_id IS NULL`,
          )
          .get<{ id: string }>(groupId, mvt.numeroPiece, mvt.date, mvt.montantCentimes)
      : null;

    if (byPiece) {
      await db
        .prepare(
          `UPDATE mouvements_caisse
              SET comptaweb_ecriture_id = ?,
                  amount_cents          = ?,
                  description           = ?,
                  type                  = COALESCE(type, ?),
                  numero_piece          = COALESCE(numero_piece, ?)
            WHERE id = ?`,
        )
        .run(
          mvt.comptawebEcritureId,
          amountSigned,
          mvt.intitule,
          inferredType,
          mvt.numeroPiece,
          byPiece.id,
        );
      stats.matched_by_fallback++;
      continue;
    }

    // 3. Insert.
    const id = await nextId('CAI');
    const now = currentTimestamp();
    await db
      .prepare(
        `INSERT INTO mouvements_caisse
           (id, group_id, date_mouvement, description, amount_cents,
            type, numero_piece, status, comptaweb_ecriture_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        groupId,
        mvt.date,
        mvt.intitule,
        amountSigned,
        inferredType,
        mvt.numeroPiece,
        inferredStatus,
        mvt.comptawebEcritureId,
        now,
      );
    stats.inserted++;
  }

  // Recalcule le solde après import pour le retour utilisateur.
  const soldeRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM mouvements_caisse WHERE group_id = ?`,
    )
    .get<{ total: number }>(groupId);
  const soldeBaloo = soldeRow?.total ?? 0;

  // Recalcul des solde_apres_cents pour conserver une chronologie
  // cohérente. Tri par date_mouvement, puis created_at.
  const ordered = await db
    .prepare(
      `SELECT id, amount_cents
         FROM mouvements_caisse
        WHERE group_id = ?
        ORDER BY date_mouvement ASC, created_at ASC`,
    )
    .all<{ id: string; amount_cents: number }>(groupId);
  let running = 0;
  for (const row of ordered) {
    running += row.amount_cents;
    await db
      .prepare('UPDATE mouvements_caisse SET solde_apres_cents = ? WHERE id = ?')
      .run(running, row.id);
  }

  return {
    caisseId: data.caisseId,
    libelle: data.libelle,
    soldeComptaweb: data.soldeCentimes,
    soldeBaloo,
    stats,
  };
}

// Détecte les lignes potentiellement orphelines après une sync.
// Critère : import Airtable (`airtable_id` posé) qui n'a pas trouvé
// de match Comptaweb après la sync (`comptaweb_ecriture_id` toujours
// null) → c'est un doublon de la ligne mère Comptaweb (ventilation
// historique de l'ancien outil).
//
// Idem côté `depots_especes` : aucune ligne Comptaweb ne pointe vers
// ces dépôts (les transferts internes sont désormais représentés
// comme des mouvements caisse `type='depot'`).
export interface CaisseOrphansSummary {
  mouvementsOrphelins: number;
  mouvementsAmountCents: number;
  depotsOrphelins: number;
  depotsAmountCents: number;
}

export async function countCaisseOrphans(
  groupId: string,
): Promise<CaisseOrphansSummary> {
  const db = getDb();
  const m = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total
         FROM mouvements_caisse
        WHERE group_id = ?
          AND airtable_id IS NOT NULL
          AND comptaweb_ecriture_id IS NULL
          AND archived_at IS NULL`,
    )
    .get<{ n: number; total: number }>(groupId);
  const d = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount_cents), 0) AS total
         FROM depots_especes
        WHERE group_id = ?
          AND ecriture_id IS NULL
          AND airtable_id IS NOT NULL
          AND archived_at IS NULL`,
    )
    .get<{ n: number; total: number }>(groupId);
  return {
    mouvementsOrphelins: m?.n ?? 0,
    mouvementsAmountCents: m?.total ?? 0,
    depotsOrphelins: d?.n ?? 0,
    depotsAmountCents: d?.total ?? 0,
  };
}

// Archive (soft-delete) les lignes orphelines de la caisse. Préfère
// poser `archived_at` plutôt que DELETE — cf. règle "JAMAIS DELETE de
// données métier" (CLAUDE.md / mémoire user). Si demain la sync les
// re-rapproche par un nouveau matching, on pourra les ré-activer.
export interface CaisseCleanupResult {
  mouvementsArchives: number;
  depotsArchives: number;
}

export async function archiveOrphanedCaisseRows(
  groupId: string,
): Promise<CaisseCleanupResult> {
  const db = getDb();
  const now = currentTimestamp();

  const before = await countCaisseOrphans(groupId);

  await db
    .prepare(
      `UPDATE mouvements_caisse
          SET archived_at = ?
        WHERE group_id = ?
          AND airtable_id IS NOT NULL
          AND comptaweb_ecriture_id IS NULL
          AND archived_at IS NULL`,
    )
    .run(now, groupId);
  await db
    .prepare(
      `UPDATE depots_especes
          SET archived_at = ?
        WHERE group_id = ?
          AND ecriture_id IS NULL
          AND airtable_id IS NOT NULL
          AND archived_at IS NULL`,
    )
    .run(now, groupId);

  // Recalcul des solde_apres_cents sur les lignes restantes (sans
  // archived) pour avoir une chronologie correcte dans l'UI.
  const ordered = await db
    .prepare(
      `SELECT id, amount_cents
         FROM mouvements_caisse
        WHERE group_id = ?
          AND archived_at IS NULL
        ORDER BY date_mouvement ASC, created_at ASC`,
    )
    .all<{ id: string; amount_cents: number }>(groupId);
  let running = 0;
  for (const row of ordered) {
    running += row.amount_cents;
    await db
      .prepare('UPDATE mouvements_caisse SET solde_apres_cents = ? WHERE id = ?')
      .run(running, row.id);
  }

  return {
    mouvementsArchives: before.mouvementsOrphelins,
    depotsArchives: before.depotsOrphelins,
  };
}

// Helper de découverte : utile au premier sync pour identifier la
// caisse (ou les caisses) du groupe sans config en dur.
export async function discoverCaisses(): Promise<
  Array<{ id: number; libelle: string; gerant: string; devise: string; inactif: boolean }>
> {
  return await withAutoReLogin((config) => fetchCaisseList(config));
}

// Résolution du caisseId à utiliser pour la sync. Stratégie :
//  1. Env var `COMPTAWEB_CAISSE_ID` (override explicite, ex. multi-caisses).
//  2. Découverte automatique via `/caisse` (filtre les caisses inactives).
// Si l'étape 2 retourne une liste vide (parsing inattendu, page différente),
// on lève une erreur explicite plutôt que silencieuse.
export async function resolveCaisseId(): Promise<number> {
  const fromEnv = process.env.COMPTAWEB_CAISSE_ID;
  if (fromEnv) {
    const n = Number(fromEnv);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`COMPTAWEB_CAISSE_ID="${fromEnv}" invalide (entier positif attendu).`);
    }
    return n;
  }

  const list = await discoverCaisses();
  const active = list.find((c) => !c.inactif);
  if (active) return active.id;

  throw new Error(
    `Aucune caisse active découverte côté Comptaweb (parser a renvoyé ${list.length} caisse(s)). ` +
      `Définir COMPTAWEB_CAISSE_ID dans l'env Vercel pour bypasser la découverte.`,
  );
}
