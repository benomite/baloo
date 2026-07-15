/** Nombre de cycles consécutifs SANS progrès (remaining non décroissant)
 *  avant d'abandonner le drainage (garde-fou anti-boucle contre un CW KO). */
export const MAX_NO_PROGRESS = 2;

/**
 * Décide si relancer un cycle de sync pour drainer le reste.
 * `prev` = remaining du cycle précédent (null au 1er) ; `next` = remaining
 * du cycle qui vient de finir ; `noProgress` = compteur courant de cycles
 * sans progrès. Retourne la décision + le compteur mis à jour.
 */
export function shouldDrainAgain(
  prev: number | null,
  next: number,
  noProgress: number,
): { drain: boolean; noProgress: number } {
  if (next <= 0) return { drain: false, noProgress: 0 };
  const progressed = prev == null || next < prev;
  if (progressed) return { drain: true, noProgress: 0 };
  const nextNoProgress = noProgress + 1;
  if (nextNoProgress >= MAX_NO_PROGRESS) return { drain: false, noProgress: nextNoProgress };
  return { drain: true, noProgress: nextNoProgress };
}
