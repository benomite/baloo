// Affichage des exercices comptables côté interface — module PUR.
//
// L'exercice SGDF court du 01/09 au 31/08 et, dans Comptaweb, c'est le contexte
// de la session (ADR-039). Pendant la période de clôture, deux exercices vivent
// en parallèle et l'interface doit le dire. Le reste de l'année, elle ne doit
// rien dire du tout : un seul exercice est actif onze mois sur douze, l'afficher
// serait du bruit permanent pour une information sans enjeu.

/** Code d'exercice (« 2025-2026 ») d'une date ISO « YYYY-MM-DD ». */
export function exerciceCodeForDate(dateIso: string): string {
  // Lecture directe de la chaîne, sans passer par `new Date` : une date ISO
  // seule vaut minuit UTC, qui bascule au jour précédent dans un fuseau
  // négatif — le 01/09 y serait lu 31/08, donc rattaché au mauvais exercice.
  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  return mois >= 9 ? `${annee}-${annee + 1}` : `${annee - 1}-${annee}`;
}

/** « 2025-2026 » → « 25/26 ». Rend la valeur telle quelle si le format surprend. */
export function abregeExercice(code: string): string {
  const m = code.match(/^\d{2}(\d{2})-\d{2}(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : code;
}

/**
 * Libellé des exercices couverts par le dernier cycle de sync, ou `null` quand
 * il n'y a rien à signaler : moins de deux exercices, ou aucune donnée (run
 * antérieur à ADR-039, qui ne renseignait pas la colonne).
 */
export function libelleExercicesCouverts(codes: string[] | null | undefined): string | null {
  if (!codes || codes.length < 2) return null;
  return codes.map(abregeExercice).join(' + ');
}
