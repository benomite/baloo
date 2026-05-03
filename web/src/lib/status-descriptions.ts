// Description en langage humain des status d'un workflow, du point de
// vue de la personne qui regarde sa propre demande (≠ point de vue
// admin).
//
// Pattern : le badge montre où on en est ; la description en dessous
// dit "ce qui s'est passé" + "ce qui se passe ensuite" ou "ce qu'on
// attend de toi". Évite que l'utilisateur lise "valide_rg" et se
// demande si c'est bon ou pas.

export interface StatusDescription {
  /** Texte court, ce qui se passe maintenant ou ce qui est attendu. */
  text: string;
  /** Action à faire par l'utilisateur, le cas échéant. Affiché en
   *  rouge/destructive pour appeler l'œil. */
  actionRequired?: string;
}

export function describeRembsStatus(status: string): StatusDescription {
  switch (status) {
    case 'a_traiter':
      return {
        text: 'En attente de validation par le trésorier.',
      };
    case 'valide_tresorier':
      return {
        text: 'Validé par le trésorier — en attente de validation par le RG.',
      };
    case 'valide_rg':
      return {
        text: 'Validé par le RG — virement bancaire à faire par le trésorier.',
      };
    case 'virement_effectue':
      return {
        text: "Virement effectué — l'argent est en route sur ton compte.",
      };
    case 'termine':
      return {
        text: 'Demande clôturée.',
      };
    case 'refuse':
      return {
        text: 'Demande refusée.',
      };
    default:
      return { text: status };
  }
}

export function describeAbandonStatus(
  status: string,
  cerfaEmis: boolean,
): StatusDescription {
  switch (status) {
    case 'a_traiter':
      return {
        text: 'En attente de validation par le trésorier.',
      };
    case 'valide':
      return {
        text: 'Validé — le trésorier va envoyer ta feuille au national.',
      };
    case 'envoye_national':
      return cerfaEmis
        ? {
            text: 'CERFA reçu — réduction d’impôt sur le revenu (art 200 CGI).',
          }
        : {
            text: 'Envoyé au national — le CERFA arrivera par mail sous 3 mois (délai SGDF).',
          };
    case 'refuse':
      return {
        text: 'Demande refusée.',
      };
    default:
      return { text: status };
  }
}
