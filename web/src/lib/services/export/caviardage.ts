// Retrait des champs sensibles avant qu'une ligne ne quitte Baloo.
//
// Appliqué au DOSSIER D'EXERCICE uniquement — le dump technique reste chez le
// trésorier et doit être fidèle (cf. ADR-040).
//
// `edit_token` et `validate_token` sont le point critique : ce sont les liens
// d'accès direct aux remboursements. Diffusés dans un Drive partagé, ils
// permettraient de modifier ou valider un remboursement EN PRODUCTION.

export const CHAMPS_SENSIBLES: Record<string, string[]> = {
  remboursements: ['rib_texte', 'rib_file_path', 'edit_token', 'validate_token'],
};

/**
 * Retire les champs sensibles d'une ligne. La clé est SUPPRIMÉE, pas mise à
 * null : une clé à null laisserait croire que la donnée n'existait pas.
 */
export function caviarder(
  table: string,
  ligne: Record<string, unknown>,
): Record<string, unknown> {
  const champs = CHAMPS_SENSIBLES[table];
  if (!champs) return ligne;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ligne)) {
    if (!champs.includes(k)) out[k] = v;
  }
  return out;
}
