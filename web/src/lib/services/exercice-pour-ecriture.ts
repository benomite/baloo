// Route une écriture vers l'exercice CW de SA date (ADR-039). Une date hors des
// exercices actifs est refusée AVANT tout appel réseau : Comptaweb, lui,
// refuserait en silence par une redirection (cas 2026-09-11).
import { fetchExercices } from '../comptaweb/exercices';
import { withAutoReLogin } from '../comptaweb/auth';
import { getGroupe } from './groupes';
import {
  exercicePourDate,
  exercicesActifs,
  type ExerciceActif,
  type ExerciceCw,
} from './exercices-actifs';

export interface ResoudreDeps {
  lireExercicesCw?: () => Promise<ExerciceCw[]>;
  lireDernierExerciceClos?: () => Promise<string | null>;
  now?: () => Date;
}

function isoToFrCourt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Résout l'exercice CW à utiliser pour créer une écriture datée `dateIso`.
 * Throw un message actionnable si cette date n'appartient à aucun exercice
 * actif (clos ou absent de Comptaweb) — AVANT tout appel réseau côté CW,
 * puisque les deps par défaut n'ouvrent une session que si elles sont
 * effectivement invoquées.
 */
export async function resoudreExercicePourDate(
  groupId: string,
  dateIso: string,
  deps: ResoudreDeps = {},
): Promise<ExerciceActif> {
  const lireExercicesCw =
    deps.lireExercicesCw ?? (async () => (await withAutoReLogin((cfg) => fetchExercices(cfg))).options);
  const lireDernierExerciceClos =
    deps.lireDernierExerciceClos ??
    (async () => (await getGroupe({ groupId }))?.dernier_exercice_clos ?? null);

  const [exercicesCw, clos] = await Promise.all([lireExercicesCw(), lireDernierExerciceClos()]);
  const { actifs } = exercicesActifs({
    exercicesCw,
    now: (deps.now ?? (() => new Date()))(),
    dernierExerciceClos: clos,
  });

  const exercice = exercicePourDate(actifs, dateIso);
  if (exercice) return exercice;

  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  const debut = mois >= 9 ? annee : annee - 1;
  const code = `${debut}-${debut + 1}`;
  throw new Error(
    `Le ${isoToFrCourt(dateIso)} appartient à l'exercice ${code}, clos ou absent de Comptaweb — ` +
      `corrige la date, ou rouvre l'exercice dans /admin/parametres.`,
  );
}
