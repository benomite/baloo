import { getCurrentContext } from '../context';
import { getDb } from '../db';
import { ensureDepotsSchema } from '../services/depots';

// Inbox du trésorier : tout ce qui attend d'être lié.
//
// Doctrine : Comptaweb pousse les lignes bancaires (deviennent des
// `ecritures`), les chefs poussent leurs reçus (deviennent des
// `depots_justificatifs` en statut `a_traiter`). Le trésorier n'a qu'à
// matcher les uns avec les autres.
//
// La query renvoie 3 collections :
//
// - `suggestions` : paires (écriture, justif) où le matching est
//   quasi-certain (montant ±2% et date ±3j). Affichées en haut, 1 clic
//   pour valider. Les éléments d'une suggestion sont retirés des deux
//   colonnes pour éviter de les voir deux fois.
//
// - `ecrituresOrphelines` : toutes les écritures qui attendent un justif
//   et n'en ont pas encore. AUCUN filtre temporel : une écriture de
//   décembre est encore là si elle n'a pas été liée. Le matching manuel
//   doit toujours rester possible quel que soit l'écart de date.
//
// - `justifsOrphelins` : tous les dépôts en statut `a_traiter`. Idem.

export interface InboxEcriture {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  unite_code: string | null;
  comptaweb_synced: 0 | 1;
}

export interface InboxJustif {
  id: string;
  titre: string;
  description: string | null;
  amount_cents: number | null;
  date_estimee: string | null;
  unite_code: string | null;
  category_name: string | null;
  submitter_name: string | null;
  submitter_email: string;
  justif_path: string | null;
  created_at: string;
}

export interface InboxSuggestion {
  ecriture: InboxEcriture;
  justif: InboxJustif;
  date_diff_days: number;
  amount_diff_cents: number;
}

export interface InboxData {
  suggestions: InboxSuggestion[];
  ecrituresOrphelines: InboxEcriture[];
  justifsOrphelins: InboxJustif[];
  totalCount: number;
  // Nombre d'écritures orphelines tronquées par la limite (pour
  // afficher un compteur "+N plus anciennes"). 0 si tout passe.
  ecrituresTruncated: number;
}

// Seuils des suggestions auto (doivent rester serrés pour éviter les
// faux positifs : un seul mauvais auto-match coûte plus cher en perte
// de confiance qu'un manuel évité).
const AUTO_AMOUNT_TOLERANCE_RATIO = 0.02; // 2 %
const AUTO_AMOUNT_TOLERANCE_FLOOR_CENTS = 100; // 1 €
const AUTO_DATE_TOLERANCE_DAYS = 3;

// Limite dure pour éviter de rendre 1000 lignes : au-delà, on tronque
// et on affiche un compteur. Le user peut élargir la période ou
// utiliser le toggle "inclure les recettes" pour ajuster.
const ECRITURES_HARD_LIMIT = 100;

export const INBOX_PERIODS = ['30j', '90j', '6mois', 'tout'] as const;
export type InboxPeriod = (typeof INBOX_PERIODS)[number];

export interface InboxOptions {
  period?: InboxPeriod;
  // Inclut les recettes (par défaut : dépenses uniquement). Les
  // recettes — cotisations parents, subventions, virements — n'ont
  // typiquement pas de "ticket de caisse" à rapprocher.
  includeRecettes?: boolean;
}

export async function listInboxItems(
  options: InboxOptions = {},
): Promise<InboxData> {
  const { groupId } = await getCurrentContext();
  await ensureDepotsSchema();
  const db = getDb();

  const period = options.period ?? '90j';
  const includeRecettes = options.includeRecettes ?? false;

  const conditions: string[] = [
    'e.group_id = ?',
    'e.justif_attendu = 1',
    `NOT EXISTS (
       SELECT 1 FROM justificatifs j
       WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
     )`,
  ];
  const values: unknown[] = [groupId];

  if (!includeRecettes) {
    conditions.push("e.type = 'depense'");
  }

  const sinceDate = computeSinceDate(period);
  if (sinceDate) {
    conditions.push('e.date_ecriture >= ?');
    values.push(sinceDate);
  }

  const [ecrituresAll, justifsOrphelins] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.date_ecriture, e.description, e.amount_cents, e.type,
                e.comptaweb_synced,
                un.code AS unite_code
         FROM ecritures e
         LEFT JOIN unites un ON un.id = e.unite_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY e.date_ecriture DESC`,
      )
      .all<InboxEcriture>(...values),
    db
      .prepare(
        `SELECT d.id, d.titre, d.description, d.amount_cents, d.date_estimee,
                d.created_at,
                un.code AS unite_code,
                c.name AS category_name,
                u.nom_affichage AS submitter_name,
                u.email AS submitter_email,
                (SELECT file_path FROM justificatifs
                  WHERE entity_type = 'depot' AND entity_id = d.id
                  ORDER BY uploaded_at DESC LIMIT 1) AS justif_path
         FROM depots_justificatifs d
         JOIN users u ON u.id = d.submitted_by_user_id
         LEFT JOIN unites un ON un.id = d.unite_id
         LEFT JOIN categories c ON c.id = d.category_id
         WHERE d.group_id = ?
           AND d.statut = 'a_traiter'
         ORDER BY d.created_at DESC`,
      )
      .all<InboxJustif>(groupId),
  ]);

  const suggestions = computeAutoSuggestions(ecrituresAll, justifsOrphelins);
  const usedEcr = new Set(suggestions.map((s) => s.ecriture.id));
  const usedJustif = new Set(suggestions.map((s) => s.justif.id));

  const remainingEcrituresAll = ecrituresAll.filter((e) => !usedEcr.has(e.id));
  const remainingJustifs = justifsOrphelins.filter((j) => !usedJustif.has(j.id));

  // Tronque côté écritures (les justifs orphelins restent rares en
  // volume ; pas de pagination dessus pour l'instant).
  const ecrituresTruncated = Math.max(
    0,
    remainingEcrituresAll.length - ECRITURES_HARD_LIMIT,
  );
  const remainingEcritures = remainingEcrituresAll.slice(0, ECRITURES_HARD_LIMIT);

  return {
    suggestions,
    ecrituresOrphelines: remainingEcritures,
    justifsOrphelins: remainingJustifs,
    totalCount: ecrituresAll.length + justifsOrphelins.length,
    ecrituresTruncated,
  };
}

// Compteur léger pour le badge sidebar : nombre total d'éléments à
// traiter (écritures sans justif "depense+attendu", dépôts orphelins),
// sans filtre période — pour que le badge représente bien le backlog
// total. Utilisé hors page /inbox, donc requête séparée et minimale.
export async function countInboxItems(groupId: string): Promise<number> {
  await ensureDepotsSchema();
  const db = getDb();

  const [ecr, dep] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM ecritures e
         WHERE e.group_id = ?
           AND e.type = 'depense'
           AND e.justif_attendu = 1
           AND NOT EXISTS (
             SELECT 1 FROM justificatifs j
             WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
           )`,
      )
      .get<{ n: number }>(groupId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM depots_justificatifs
         WHERE group_id = ? AND statut = 'a_traiter'`,
      )
      .get<{ n: number }>(groupId),
  ]);

  return (ecr?.n ?? 0) + (dep?.n ?? 0);
}

function computeSinceDate(period: InboxPeriod): string | null {
  if (period === 'tout') return null;
  const now = new Date();
  const days = period === '30j' ? 30 : period === '90j' ? 90 : 180;
  now.setDate(now.getDate() - days);
  return now.toISOString().slice(0, 10);
}

// Heuristique gloutonne : pour chaque écriture, on prend le 1er justif
// libre qui matche. Pas de scoring sophistiqué, juste un seuil serré.
// L'ordre de scan suit l'ordre des deux listes (chronologique inverse).
function computeAutoSuggestions(
  ecritures: InboxEcriture[],
  justifs: InboxJustif[],
): InboxSuggestion[] {
  const out: InboxSuggestion[] = [];
  const used = new Set<string>();

  for (const ecr of ecritures) {
    const eAmount = Math.abs(ecr.amount_cents);
    const tol = Math.max(
      AUTO_AMOUNT_TOLERANCE_FLOOR_CENTS,
      Math.round(eAmount * AUTO_AMOUNT_TOLERANCE_RATIO),
    );
    let best: { justif: InboxJustif; amountDiff: number; dateDiff: number } | null = null;
    for (const j of justifs) {
      if (used.has(j.id)) continue;
      if (j.amount_cents == null || j.date_estimee == null) continue;
      const jAmount = Math.abs(j.amount_cents);
      const amountDiff = Math.abs(eAmount - jAmount);
      if (amountDiff > tol) continue;
      const dateDiff = daysBetween(ecr.date_ecriture, j.date_estimee);
      if (dateDiff > AUTO_DATE_TOLERANCE_DAYS) continue;
      if (
        best === null ||
        amountDiff < best.amountDiff ||
        (amountDiff === best.amountDiff && dateDiff < best.dateDiff)
      ) {
        best = { justif: j, amountDiff, dateDiff };
      }
    }
    if (best) {
      used.add(best.justif.id);
      out.push({
        ecriture: ecr,
        justif: best.justif,
        amount_diff_cents: best.amountDiff,
        date_diff_days: best.dateDiff,
      });
    }
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
