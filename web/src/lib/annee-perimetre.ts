import { defaultActivitesExcluesIds } from './services/annee';
import { currentExercice } from './services/overview';

// Helpers purs de la page Année : lecture du périmètre depuis l'URL.
// Module séparé (sans 'use server', sans accès BDD) pour être testable et
// réutilisable par la page liste comme par la page détail d'unité.

export const ADMIN_ROLES = ['tresorier', 'RG'];

/** Sentinelle « ne rien exclure » — distinguer d'un `hors` absent (= défaut). */
export const HORS_AUCUN = '-';

/**
 * Résout la liste d'activités exclues depuis le param d'URL.
 *
 * - absent      → défaut du groupe (les activités de camp)
 * - `-`         → aucune exclusion (l'utilisateur a tout réintégré)
 * - `a,b`       → ces ids, filtrés sur les activités réellement existantes
 *                 (un id inconnu dans l'URL ne doit pas fausser le périmètre)
 */
export function parseHors(
  hors: string | undefined,
  activites: { id: string; name: string | null }[],
): string[] {
  if (hors === undefined) return defaultActivitesExcluesIds(activites);
  if (hors === HORS_AUCUN || hors === '') return [];
  const connus = new Set(activites.map((a) => a.id));
  return hors.split(',').map((s) => s.trim()).filter((id) => connus.has(id));
}

/** Reconduit le param `hors` dans un lien, en préservant l'absence. */
export function horsParam(hors: string | undefined): string {
  return hors === undefined ? '' : `&hors=${encodeURIComponent(hors)}`;
}

/** Les 4 derniers exercices, courant en premier. */
export function saisonOptions(now: Date = new Date()): { value: string; label: string }[] {
  const curStart = parseInt(currentExercice(now).split('-')[0], 10);
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const y = curStart - i;
    opts.push({ value: `${y}-${y + 1}`, label: `Sept ${y} → Août ${y + 1}` });
  }
  return opts;
}
