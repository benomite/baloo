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

export function computeReadiness(
  ecriture: Ecriture,
  refs: {
    categories: Category[];
    unites: Unite[];
    modesPaiement: ModePaiement[];
    activites: Activite[];
  },
): ReadinessReport {
  if (ecriture.comptaweb_ecriture_id) {
    return {
      level: 'synced',
      missingFields: [],
      message: `Synchronisée Comptaweb (id #${ecriture.comptaweb_ecriture_id})`,
    };
  }

  const missing: string[] = [];

  const checkMapped = (label: string, id: string | null, list: RefMaybe[]) => {
    if (!id) {
      missing.push(label);
      return;
    }
    const ref = findById(list, id);
    if (!ref) {
      missing.push(`${label} (introuvable)`);
      return;
    }
    if (ref.comptaweb_id === null) {
      missing.push(`${label} (non synchronisable Comptaweb)`);
    }
  };

  checkMapped('catégorie', ecriture.category_id, refs.categories);
  checkMapped('unité', ecriture.unite_id, refs.unites);
  checkMapped('activité', ecriture.activite_id, refs.activites);
  checkMapped('mode de paiement', ecriture.mode_paiement_id, refs.modesPaiement);

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
