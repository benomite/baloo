// Exercices SGDF actifs pour un groupe : module pur (ni BDD ni HTTP).
//
// L'exercice court du 01/09 au 31/08 et, dans Comptaweb, c'est le contexte de
// la session — pas un filtre (cf. ADR-039). Pendant la clôture (septembre →
// declaration de cloture), deux exercices vivent en parallele : les depenses
// de camp d'aout se saisissent encore sur l'ancien pendant que la rentree
// alimente le nouveau.
import { currentExercice, exerciceBounds } from './overview';

/** Une option du select de `/exercice?m=1` cote Comptaweb. */
export interface ExerciceCw {
  cwId: number;
  libelle: string;
}

/** Un exercice actif, pret a etre route vers sa connexion CW. */
export interface ExerciceActif {
  code: string; // '2025-2026'
  cwId: number;
  debut: string; // ISO '2025-09-01'
  fin: string; // ISO '2026-08-31'
}

/** « Sept 2025 - Aout 2026 » → '2025-2026'. Null si le libelle est inattendu. */
export function codeFromLibelle(libelle: string): string | null {
  const m = libelle.match(/(\d{4})\D+(\d{4})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function toActif(code: string, cwId: number): ExerciceActif {
  const { start, end } = exerciceBounds(code);
  return { code, cwId, debut: start, fin: end };
}

function codePrecedent(code: string): string {
  const debut = Number(code.slice(0, 4)) - 1;
  return `${debut}-${debut + 1}`;
}

/**
 * Exercices sur lesquels Baloo doit travailler : celui de la date du jour, plus
 * le precedent TANT QU'IL N'EST PAS declare clos (reglage groupe
 * `dernier_exercice_clos`). Le plus recent d'abord — c'est l'ordre de priorite
 * de la sync.
 */
export function exercicesActifs(input: {
  exercicesCw: ExerciceCw[];
  now?: Date;
  dernierExerciceClos?: string | null;
}): { actifs: ExerciceActif[]; avertissement: string | null } {
  const parCode = new Map<string, number>();
  for (const e of input.exercicesCw) {
    const code = codeFromLibelle(e.libelle);
    if (code) parCode.set(code, e.cwId);
  }

  const codeCourant = currentExercice(input.now ?? new Date());
  const codeAncien = codePrecedent(codeCourant);
  const clos = input.dernierExerciceClos ?? null;

  const actifs: ExerciceActif[] = [];
  let avertissement: string | null = null;

  const idCourant = parCode.get(codeCourant);
  if (idCourant !== undefined) {
    actifs.push(toActif(codeCourant, idCourant));
  } else {
    avertissement = `L'exercice ${codeCourant} n'existe pas encore dans Comptaweb.`;
  }

  // Comparaison de chaines suffisante : 'YYYY-YYYY' s'ordonne comme les annees.
  const ancienClos = clos !== null && clos >= codeAncien;
  const idAncien = parCode.get(codeAncien);
  if (!ancienClos && idAncien !== undefined) {
    actifs.push(toActif(codeAncien, idAncien));
  }

  return { actifs, avertissement };
}

/** L'exercice actif auquel appartient une date ISO, ou null (hors perimetre). */
export function exercicePourDate(actifs: ExerciceActif[], dateIso: string): ExerciceActif | null {
  return actifs.find((e) => dateIso >= e.debut && dateIso <= e.fin) ?? null;
}
