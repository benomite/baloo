// Validation du réglage « dernier exercice clos ». Module pur (pas d'I/O,
// pas de dépendance BDD/contexte/next-navigation) — extrait de la server
// action `updateExerciceClos` pour pouvoir le tester sans simuler
// `getCurrentContext()` / `requireAdmin()` / `redirect()`.

const FORMAT_EXERCICE = /^\d{4}-\d{4}$/;
const MESSAGE_ERREUR = 'Format attendu : 2025-2026.';

/**
 * Valide la saisie du réglage « dernier exercice clos ».
 * Champ vide (ou blancs) → null : l'exercice est rouvert, la déclaration
 * est réversible.
 */
export function parseExerciceClosInput(
  raw: string,
): { ok: true; valeur: string | null } | { ok: false; erreur: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, valeur: null };
  if (!FORMAT_EXERCICE.test(trimmed)) return { ok: false, erreur: MESSAGE_ERREUR };
  return { ok: true, valeur: trimmed };
}
