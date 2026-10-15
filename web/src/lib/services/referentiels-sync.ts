// Sync des référentiels Comptaweb sur TOUS les exercices actifs (ADR-041).
//
// Comptaweb renumérote unités (branches/projets) et activités à chaque
// exercice, et ses référentiels se lisent dans le contexte de la session. On
// lit donc chaque exercice actif dans sa propre session : pendant la clôture
// (septembre → déclaration de clôture), une écriture d'août part encore sur
// l'ancien exercice, avec les IDs de l'ancien exercice.
//
// Partagé par la server action (bouton « Synchroniser les configs ») et le
// tool MCP `cw_sync_referentiels` (ADR-038).
import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import {
  applyReferentielsSync,
  fetchAllCartes,
  fetchReferentielsCreer,
  withComptaweb,
  type RefSyncStats,
  type SyncReferentielsReport,
} from '../comptaweb';
import { decouvrirExercices } from './sync-cycle';

export interface SyncReferentielsTousExercicesReport extends SyncReferentielsReport {
  /** Codes des exercices synchronisés, du plus ancien au plus récent. */
  exercices: string[];
}

function cumuler(a: RefSyncStats, b: RefSyncStats): RefSyncStats {
  return {
    ajoutees: a.ajoutees + b.ajoutees,
    mappees: a.mappees + b.mappees,
    inchangees: a.inchangees + b.inchangees,
    // Les orphelines sont celles de l'exercice le plus récent (traité en dernier).
    orphelines: b.orphelines,
  };
}

export async function syncReferentielsTousExercices(groupId: string): Promise<SyncReferentielsTousExercicesReport> {
  const actifs = await decouvrirExercices(groupId);
  if (actifs.length === 0) {
    throw new Error('Aucun exercice actif trouvé dans Comptaweb.');
  }
  // Du plus ancien au plus récent : le dernier ID vu (colonne historique
  // comptaweb_id) est ainsi celui de l'exercice courant.
  const ordre = [...actifs].reverse();

  let cumul: SyncReferentielsReport | null = null;
  for (const exercice of ordre) {
    const [refs, cartes] = await withComptaweb(exercice.cwId, async (cfg) => {
      const r = await fetchReferentielsCreer(cfg);
      const c = await fetchAllCartes(cfg);
      return [r, c] as const;
    });
    const report = await applyReferentielsSync(
      getDb(),
      groupId,
      {
        brancheprojet: refs.brancheprojet,
        nature: refs.nature,
        activite: refs.activite,
        modetransaction: refs.modetransaction,
        cartes,
      },
      currentTimestamp(),
      exercice.code,
    );
    cumul = cumul
      ? {
          unites: cumuler(cumul.unites, report.unites),
          categories: cumuler(cumul.categories, report.categories),
          activites: cumuler(cumul.activites, report.activites),
          modes_paiement: cumuler(cumul.modes_paiement, report.modes_paiement),
          cartes: cumuler(cumul.cartes, report.cartes),
        }
      : report;
  }
  return { ...cumul!, exercices: ordre.map((e) => e.code) };
}
