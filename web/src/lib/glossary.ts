// Glossaire centralisé des libellés user-facing pour les concepts dont
// le nom technique (route, table, type TS) ne peut pas changer sans
// gros refactor. Permet de renommer dans toute l'UI en un seul endroit.
//
// Convention : utiliser ces libellés pour le texte exposé au
// trésorier / aux chefs / aux parents. Ne pas les utiliser dans les
// commentaires internes ni dans les noms d'identifiants techniques.
//
// "Abandon de frais" est le terme officiel SGDF (cf. doc/aide). Mais
// il prête à confusion ("abandonner" = renoncer ? rejeter ? donner ?).
// "Don au groupe" est plus parlant pour le grand public.

export const TERMS = {
  abandon: {
    singular: 'Don au groupe',
    plural: 'Dons au groupe',
    verb: 'Faire un don au groupe',
    actor: 'Donateur',
    // Mention légale conservée quand on parle du dispositif fiscal.
    legal: 'Abandon de frais (art. 200 CGI)',
  },
  remboursement: {
    singular: 'Remboursement',
    plural: 'Remboursements',
    verb: 'Demander un remboursement',
  },
} as const;
