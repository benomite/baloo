import { getDb } from '../db';
import { ensureDepotsSchema, attachDepotToEcriture } from './depots';
import { logError } from '../log';

// Auto-rapprochement : appelé au chargement de /inbox. Lie en silence
// les paires (écriture, justif) avec match ultra-parfait pour
// concrétiser la doctrine "le trésorier ne fait que matcher". Le seuil
// est volontairement très serré : un faux positif silencieux est
// beaucoup plus coûteux qu'un manuel évité.
//
// Règles :
//   - dépense uniquement (pas de recettes)
//   - écriture en attente de justif (`justif_attendu = 1`)
//   - dépôt en statut `a_traiter`
//   - montants en valeur absolue STRICTEMENT égaux
//   - écart de date ≤ 1 jour
//   - **unicité symétrique** : 1 seule écriture matche le justif et 1
//     seul justif matche l'écriture. Si > 1 candidat d'un côté ou de
//     l'autre, on skip (le trésorier doit trancher).
//
// La liaison réutilise `attachDepotToEcriture` (donc cohérent avec le
// flux manuel : migre le file, met le statut du dépôt à `rattache`,
// enrichit les champs vides de l'écriture brouillon).

const STRICT_DATE_TOLERANCE_DAYS = 1;

interface AutoLinkPair {
  ecritureId: string;
  depotId: string;
}

export interface AutoLinkResult {
  applied: number;
  pairs: AutoLinkPair[];
}

export async function applyAutoLinks(groupId: string): Promise<AutoLinkResult> {
  await ensureDepotsSchema();
  const db = getDb();

  const ecritures = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.amount_cents
       FROM ecritures e
       WHERE e.group_id = ?
         AND e.type = 'depense'
         AND e.justif_attendu = 1
         AND NOT EXISTS (
           SELECT 1 FROM justificatifs j
           WHERE j.entity_type = 'ecriture' AND j.entity_id = e.id
         )`,
    )
    .all<{ id: string; date_ecriture: string; amount_cents: number }>(groupId);

  if (ecritures.length === 0) return { applied: 0, pairs: [] };

  const justifs = await db
    .prepare(
      `SELECT id, amount_cents, date_estimee
       FROM depots_justificatifs
       WHERE group_id = ?
         AND statut = 'a_traiter'
         AND amount_cents IS NOT NULL
         AND date_estimee IS NOT NULL`,
    )
    .all<{ id: string; amount_cents: number; date_estimee: string }>(groupId);

  if (justifs.length === 0) return { applied: 0, pairs: [] };

  // Construction des candidats : pour chaque écriture, la liste des
  // justifs qui matchent strictement, et symétriquement.
  const justifCandidatesByEcr = new Map<string, string[]>();
  const ecrCandidatesByJustif = new Map<string, string[]>();

  for (const e of ecritures) {
    const eAmount = Math.abs(e.amount_cents);
    for (const j of justifs) {
      const jAmount = Math.abs(j.amount_cents);
      if (eAmount !== jAmount) continue;
      const dateDiff = daysBetween(e.date_ecriture, j.date_estimee);
      if (dateDiff > STRICT_DATE_TOLERANCE_DAYS) continue;
      pushTo(justifCandidatesByEcr, e.id, j.id);
      pushTo(ecrCandidatesByJustif, j.id, e.id);
    }
  }

  // On ne lie que les paires sans ambiguïté ni d'un côté ni de l'autre.
  const applied: AutoLinkPair[] = [];
  for (const [ecrId, justifIds] of justifCandidatesByEcr) {
    if (justifIds.length !== 1) continue;
    const justifId = justifIds[0];
    const reverseList = ecrCandidatesByJustif.get(justifId);
    if (!reverseList || reverseList.length !== 1) continue;

    try {
      await attachDepotToEcriture({ groupId }, justifId, ecrId);
      applied.push({ ecritureId: ecrId, depotId: justifId });
    } catch (err) {
      // Échec isolé : on loggue et on continue avec les autres paires.
      // Cas typique : la paire a été liée par un appel concurrent
      // entre le SELECT et l'UPDATE, ou le statut du dépôt a changé.
      logError('inbox-auto/apply', 'auto-link failed', err, {
        ecritureId: ecrId,
        depotId: justifId,
      });
    }
  }

  return { applied: applied.length, pairs: applied };
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
