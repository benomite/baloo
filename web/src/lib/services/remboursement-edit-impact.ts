// Conséquence d'une édition de fond sur le workflow d'un remboursement.
// Module pur (pas d'I/O) — testable sans BDD ni session.
//
// Éditer les lignes / l'identité / le RIB change ce sur quoi les validations
// ont porté : les signatures deviennent caduques (elles sont marquées périmées,
// jamais supprimées). Le statut doit donc suivre, sinon la demande affirme une
// validation que plus aucune signature n'atteste — et se retrouve coincée, car
// aucune transition ne redescend vers `a_traiter`.
//
// Bug terrain 2026-08-17, RBT-2026-030 : édition d'une demande
// `valide_tresorier` → signature trésorier effacée, statut inchangé, étape
// affichée « sautée » et plus aucune action possible pour le trésorier.
//
// Après le virement, en revanche, l'argent est parti : rouvrir la demande
// mentirait sur la réalité. L'édition de fond est refusée (l'édition limitée
// notes / RIB reste disponible).

export type EditImpact =
  | { allowed: true; resetStatusTo: 'a_traiter' | null }
  | { allowed: false; reason: string };

export function planEditImpact(status: string): EditImpact {
  switch (status) {
    case 'a_traiter':
      return { allowed: true, resetStatusTo: null };
    case 'valide_tresorier':
    case 'valide_rg':
    case 'refuse':
      return { allowed: true, resetStatusTo: 'a_traiter' };
    case 'virement_effectue':
      return {
        allowed: false,
        reason:
          'Le virement a déjà été effectué : la demande ne peut plus être modifiée sur le fond. '
          + 'Tu peux encore ajuster les notes et le RIB.',
      };
    case 'termine':
      return {
        allowed: false,
        reason:
          'La demande est terminée : elle ne peut plus être modifiée sur le fond. '
          + 'Tu peux encore ajuster les notes et le RIB.',
      };
    default:
      // Statut inattendu : on ne devine pas ce que l'édition impliquerait.
      return { allowed: false, reason: `Statut « ${status} » non modifiable.` };
  }
}
