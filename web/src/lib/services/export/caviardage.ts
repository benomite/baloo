// Retrait des champs sensibles avant qu'une ligne ne quitte Baloo.
//
// Appliqué au DOSSIER D'EXERCICE uniquement — le dump technique reste chez le
// trésorier et doit être fidèle (cf. ADR-040).
//
// Deux catégories de sensibilité :
//
// 1. **Tokens d'accès directs** : `edit_token` et `validate_token` des
//    remboursements sont les liens actifs pour modifier/valider un remboursement
//    EN PRODUCTION. Diffusés dans un Drive partagé, ils compromettent directement
//    la trésorerie.
//
// 2. **Coordonnées bancaires** : IBAN, BIC, et RIB ne servent qu'à effectuer
//    des paiements. Une fois l'exercice clos, tous les paiements sont faits.
//    Ces champs n'ont aucune valeur archivale — un compte reste identifiable
//    par son `code`, son `nom`, sa `banque` et son `comptaweb_id`.

export const CHAMPS_SENSIBLES: Record<string, string[]> = {
  remboursements: ['rib_texte', 'rib_file_path', 'edit_token', 'validate_token'],
  comptes_bancaires: ['iban', 'bic'],
  groupes: ['iban_principal'],
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
