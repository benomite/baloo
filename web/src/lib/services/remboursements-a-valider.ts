// Vue « À valider » : ce qu'un rôle donné doit signer, et où son lien
// d'accès direct doit l'amener. Module pur (pas d'I/O) — testable sans
// BDD ni session. Aligné sur la garde de transition
// (`remboursements-transitions.ts`) : le trésorier valide le premier
// (`a_traiter`), le RG contresigne ensuite (`valide_tresorier`).

/**
 * Statut des remboursements que ce rôle doit valider, ou `null` s'il ne
 * valide rien. Sert à filtrer l'onglet « À valider » de /remboursements
 * de façon contextuelle au rôle connecté.
 */
export function statutAValiderPourRole(role: string): string | null {
  switch (role) {
    case 'tresorier':
      return 'a_traiter';
    case 'RG':
      return 'valide_tresorier';
    default:
      return null;
  }
}

/**
 * Destination du lien d'accès direct (auto-connexion) selon le rôle de
 * l'invitation. Un RG atterrit sur sa file de validation ; tous les
 * autres rôles gardent le formulaire de saisie (flow soumission
 * parents/membres inchangé).
 */
export function callbackUrlForRole(role: string): string {
  return role === 'RG'
    ? '/remboursements?tab=a-valider'
    : '/remboursements/nouveau';
}
