// Calcule l'état d'une écriture vis-à-vis du workflow Baloo + Comptaweb.
// 3 niveaux pour l'utilisateur :
//   - 'synced'      : déjà créée dans Comptaweb (immutable côté sync)
//   - 'ready'       : tout est OK pour sync, manque juste le clic
//   - 'incomplete'  : il manque des champs (saisie ou mapping CW)
//
// La règle "complet pour sync CW" est plus stricte que "complet pour
// valider" : il faut que les FK pointent vers des entrées qui ont un
// comptaweb_id (sinon Comptaweb ne saura pas où ranger l'écriture).

import type {
  Ecriture,
  Category,
  Unite,
  ModePaiement,
  Activite,
} from './types';

export type ReadinessLevel = 'synced' | 'ready' | 'incomplete';

export interface ReadinessReport {
  level: ReadinessLevel;
  missingFields: string[]; // libellés humains des champs manquants
  message: string;
}

interface RefMaybe {
  id: string;
  comptaweb_id: number | null;
}

function findById<T extends { id: string }>(arr: T[], id: string | null): T | undefined {
  if (!id) return undefined;
  return arr.find((x) => x.id === id);
}

interface Refs {
  categories: Category[];
  unites: Unite[];
  modesPaiement: ModePaiement[];
  activites: Activite[];
}

// Readiness d'un GROUPE de ventilation, qui ne fait qu'UNE pièce Comptaweb
// (`syncDraftToComptaweb` envoie les champs d'en-tête de la tête + N
// ventilations). Deux natures de champs, donc deux portées de contrôle :
//   - en-tête de pièce (mode de paiement) : jugé UNE fois, sur la tête — c'est
//     le seul que le pipeline CW lit ; l'exiger sur chaque ligne bloquait la
//     validation à tort (cas prod 2026-07-27, virement groupé MERSCH) ;
//   - imputation (catégorie / unité / activité) : jugée LIGNE PAR LIGNE, avec
//     le même préfixe « Ventilation N — » que les erreurs de `drafts.ts`.
// `members` doit venir tête d'abord (cf. buildEcritureGroups). Sur un groupe
// d'une seule ligne, le verdict est identique à `computeReadiness`.
export function computeGroupReadiness(members: Ecriture[], refs: Refs): ReadinessReport {
  const [head] = members;
  if (head.comptaweb_ecriture_id) return computeReadiness(head, refs);

  // Même ordre que computeReadiness (imputation puis en-tête) → sur une
  // mono-ligne, verdict et libellés strictement identiques.
  const missing: string[] = [];
  members.forEach((m, i) => {
    const prefix = members.length > 1 ? `Ventilation ${i + 1} — ` : '';
    collectMissing(missing, m, refs, { scope: 'imputation', prefix });
  });
  collectMissing(missing, head, refs, { scope: 'entete' });
  return report(missing);
}

export function computeReadiness(ecriture: Ecriture, refs: Refs): ReadinessReport {
  if (ecriture.comptaweb_ecriture_id) {
    return {
      level: 'synced',
      missingFields: [],
      message: `Synchronisée Comptaweb (id #${ecriture.comptaweb_ecriture_id})`,
    };
  }

  const missing: string[] = [];
  collectMissing(missing, ecriture, refs, { scope: 'imputation' });
  collectMissing(missing, ecriture, refs, { scope: 'entete' });
  return report(missing);
}

// Champs manquants d'une écriture, par portée : 'imputation' = ce qui vit sur
// la ventilation (catégorie / unité / activité), 'entete' = ce qui vit sur la
// pièce (mode de paiement). Un champ manque s'il est vide, si la FK ne résout
// pas, ou si la référence n'a pas de comptaweb_id (Comptaweb ne saurait pas où
// la ranger).
function collectMissing(
  missing: string[],
  ecriture: Ecriture,
  refs: Refs,
  opts: { scope: 'imputation' | 'entete'; prefix?: string },
): void {
  const prefix = opts.prefix ?? '';
  const checkMapped = (label: string, id: string | null, list: RefMaybe[]) => {
    if (!id) {
      missing.push(`${prefix}${label}`);
      return;
    }
    const ref = findById(list, id);
    if (!ref) {
      missing.push(`${prefix}${label} (introuvable)`);
      return;
    }
    if (ref.comptaweb_id === null) {
      missing.push(`${prefix}${label} (non synchronisable Comptaweb)`);
    }
  };

  if (opts.scope === 'imputation') {
    checkMapped('catégorie', ecriture.category_id, refs.categories);
    checkMapped('unité', ecriture.unite_id, refs.unites);
    checkMapped('activité', ecriture.activite_id, refs.activites);
  } else {
    checkMapped('mode de paiement', ecriture.mode_paiement_id, refs.modesPaiement);
  }
}

function report(missing: string[]): ReadinessReport {
  if (missing.length === 0) {
    return {
      level: 'ready',
      missingFields: [],
      message: 'Prête à synchroniser Comptaweb',
    };
  }

  return {
    level: 'incomplete',
    missingFields: missing,
    message: `À compléter avant sync : ${missing.join(', ')}`,
  };
}
