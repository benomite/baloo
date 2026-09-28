// Quelles tables partent dans un dump, et comment on borne leurs lignes au
// groupe. Module pur : aucune SQL ici, juste la déclaration.
//
// INVARIANT : toute table du schéma est soit incluse, soit explicitement
// exclue. `classifierTables` le vérifie, et le test échoue si une table
// nouvelle n'a pas été classée — sinon une table d'authentification
// ajoutée plus tard partirait silencieusement dans les dumps suivants.
//
// Quatre régimes de sélection (`RegimeSelection`) :
// - 'group_id' : la table porte directement une colonne group_id.
// - 'racine'   : la table EST le groupe (clé 'id', pas de colonne
//   group_id) — une seule ligne sélectionnée par id. Cas de `groupes`.
// - 'global'   : référentiel partagé par tous les groupes (pas de
//   group_id) — exporté en entier.
// - 'par_fk'   : pas de group_id, bornée par jointure vers un ou
//   plusieurs parents (`parents`, union : une ligne est retenue si AU
//   MOINS UNE jointure la rattache au groupe). Un parent qui n'a lui-même
//   pas de group_id peut chaîner via `via` jusqu'à un ancêtre qui en a un
//   (ex. remboursement_ligne_justificatifs → remboursement_lignes →
//   remboursements).

export type RegimeSelection = 'group_id' | 'racine' | 'global' | 'par_fk';

export interface Jointure {
  table: string; // la table parente
  cleLocale: string; // la colonne de LA TABLE COURANTE qui pointe vers le parent
  cleParent: string; // la colonne du parent visée (en général 'id')
  via?: Jointure; // si le parent n'a pas de group_id, comment remonter encore
}

export interface TableExport {
  nom: string;
  regime: RegimeSelection;
  parents?: Jointure[]; // union : une ligne est retenue si UNE des jointures la rattache au groupe
}

export const TABLES_EXCLUES: string[] = [
  // Authentification / secrets.
  'comptaweb_credentials',
  'api_tokens',
  'oauth_clients',
  'oauth_access_tokens',
  'oauth_authorization_codes',
  'sessions',
  'login_codes',
  'signin_attempts',
  'verification_tokens',
  'invite_links',
  // Log technique global (mod/message/stack), pas de colonne group_id :
  // ni 'group_id' (planterait la génération SQL, la colonne n'existe
  // pas) ni 'global' (ferait fuiter les erreurs de tous les groupes dans
  // l'archive d'un seul). Pas une donnée de compta de toute façon.
  'error_log',
];

export const TABLES_INCLUSES: TableExport[] = [
  { nom: 'groupes', regime: 'racine' },
  { nom: 'ecritures', regime: 'group_id' },
  { nom: 'justificatifs', regime: 'group_id' },
  { nom: 'depots_justificatifs', regime: 'group_id' },
  { nom: 'remboursements', regime: 'group_id' },
  { nom: 'abandons_frais', regime: 'group_id' },
  { nom: 'mouvements_caisse', regime: 'group_id' },
  { nom: 'depots_cheques', regime: 'group_id' },
  { nom: 'depots_especes', regime: 'group_id' },
  { nom: 'camps', regime: 'group_id' },
  { nom: 'cartes', regime: 'group_id' },
  { nom: 'comptes_bancaires', regime: 'group_id' },
  { nom: 'personnes', regime: 'group_id' },
  { nom: 'unites', regime: 'group_id' },
  { nom: 'activites', regime: 'group_id' },
  { nom: 'budgets', regime: 'group_id' },
  { nom: 'repartitions_unites', regime: 'group_id' },
  { nom: 'notes', regime: 'group_id' },
  { nom: 'todos', regime: 'group_id' },
  { nom: 'users', regime: 'group_id' },
  { nom: 'comptaweb_imports', regime: 'group_id' },
  { nom: 'sync_runs', regime: 'group_id' },
  { nom: 'cw_link_suggestions', regime: 'group_id' },
  { nom: 'inbox_suggestion_rejets', regime: 'group_id' },
  // avances_camp porte SA PROPRE colonne group_id (cf. camp-avances.ts) :
  // pas besoin de jointure vers camps, malgré l'apparence de table fille.
  { nom: 'avances_camp', regime: 'group_id' },

  // Référentiels partagés par tous les groupes : pas de colonne group_id.
  { nom: 'categories', regime: 'global' },
  { nom: 'modes_paiement', regime: 'global' },

  // Tables filles sans group_id : bornées par jointure sur leur(s) parent(s).
  {
    nom: 'remboursement_lignes',
    regime: 'par_fk',
    parents: [{ table: 'remboursements', cleLocale: 'remboursement_id', cleParent: 'id' }],
  },
  {
    nom: 'remboursement_ligne_justificatifs',
    regime: 'par_fk',
    // remboursement_lignes n'a pas non plus de group_id : on remonte un
    // cran de plus jusqu'à remboursements via `via`.
    parents: [
      {
        table: 'remboursement_lignes',
        cleLocale: 'ligne_id',
        cleParent: 'id',
        via: { table: 'remboursements', cleLocale: 'remboursement_id', cleParent: 'id' },
      },
    ],
  },
  {
    nom: 'signatures',
    regime: 'par_fk',
    // document_type vaut 'remboursement' OU 'abandon' (colonne
    // document_id polymorphe) : deux parents possibles, union. Un parent
    // unique perdrait silencieusement la moitié des signatures — la
    // valeur probante des documents.
    parents: [
      { table: 'remboursements', cleLocale: 'document_id', cleParent: 'id' },
      { table: 'abandons_frais', cleLocale: 'document_id', cleParent: 'id' },
    ],
  },
  {
    nom: 'budget_lignes',
    regime: 'par_fk',
    parents: [{ table: 'budgets', cleLocale: 'budget_id', cleParent: 'id' }],
  },
  {
    nom: 'comptaweb_lignes',
    regime: 'par_fk',
    parents: [{ table: 'comptaweb_imports', cleLocale: 'import_id', cleParent: 'id' }],
  },
  {
    nom: 'user_unites',
    regime: 'par_fk',
    parents: [{ table: 'users', cleLocale: 'user_id', cleParent: 'id' }],
  },
];

export function classifierTables(toutesLesTables: string[]): {
  manquantes: string[];
  inconnues: string[];
} {
  const declarees = new Set([...TABLES_INCLUSES.map((t) => t.nom), ...TABLES_EXCLUES]);
  const reelles = new Set(toutesLesTables);
  return {
    manquantes: toutesLesTables.filter((t) => !declarees.has(t)),
    inconnues: [...declarees].filter((t) => !reelles.has(t)),
  };
}
