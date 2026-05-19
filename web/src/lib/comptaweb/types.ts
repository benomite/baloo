export interface ComptawebConfig {
  baseUrl: string;
  cookie: string;
}

export interface SousLigneDsp2 {
  montantCentimes: number;
  commercant: string;
}

export interface EcritureBancaireNonRapprochee {
  id: number;
  dateOperation: string;
  montantCentimes: number;
  intitule: string;
  sousLignes: SousLigneDsp2[];
}

export interface EcritureComptableNonRapprochee {
  id: number;
  dateEcriture: string;
  type: string;
  intitule: string;
  devise: string;
  montantCentimes: number;
  numeroPiece: string;
  modeTransaction: string;
  tiers: string;
}

export interface RapprochementBancaireData {
  idCompte: number;
  libelleCompte: string;
  ecrituresComptables: EcritureComptableNonRapprochee[];
  ecrituresBancaires: EcritureBancaireNonRapprochee[];
}

export interface RefOption {
  value: string;
  label: string;
}

export interface ReferentielsCreerEcriture {
  csrfToken: string;
  depenserecette: RefOption[];
  devise: RefOption[];
  modetransaction: RefOption[];
  comptebancaire: RefOption[];
  chequier: RefOption[];
  cartebancaire: RefOption[];
  carteprocurement: RefOption[];
  caisse: RefOption[];
  tierscateg: RefOption[];
  tiersstructure: RefOption[];
  nature: RefOption[];
  activite: RefOption[];
  brancheprojet: RefOption[];
}

export type EcritureType = 'depense' | 'recette';

/**
 * Une ligne du tableau `/recettedepense?m=1` côté Comptaweb. Utilisée
 * par la sync incrémentale Phase 2 pour matcher les écritures Baloo
 * `pending_sync` (champ `cw_numero_piece` = String(id)) et les promouvoir
 * en `mirror`.
 */
export interface CwEcritureRow {
  /** ID interne CW, extrait du href `/recettedepense/<ID>/afficher`. Stable. */
  id: number;
  /** Numéro de pièce comptable (texte de la cellule, ex "ECR-2026-213").
   *  Peut être vide pour certaines lignes (ex: prélèvements regroupés). */
  numeroPiece: string;
  /** Date d'écriture en ISO YYYY-MM-DD, lue depuis `<div class="hidden">YYYYMMDD</div>`. */
  dateEcriture: string;
  /** Type déduit du remplissage des colonnes Dépense/Recette. */
  type: EcritureType;
  /** Intitulé (texte trimé). */
  intitule: string;
  /** Toujours positif en centimes ; le signe est porté par `type`. */
  montantCentimes: number;
  /** Libellé du compte bancaire (ex "GROUPE VAL DE SAONE"). */
  compteBancaire: string;
  /** Libellé du mode de transaction (ex "Virement"). */
  modeTransaction: string;
  /** Libellé de la catégorie tiers (ex "Echelon National"). */
  categorieTiers: string;
  /** Libellé de la structure tiers (ex "National"). Souvent vide. */
  structureTiers: string;
  /** Vrai si la ligne affiche le bouton "écriture rapprochée"
   *  (lien `/rapprochementbancaire/voir/...`). Utile pour la stratégie
   *  de matching mirror : rapprochée = définitive côté CW. */
  rapproche: boolean;
}

export interface ScrapeListeEcrituresResult {
  ecritures: CwEcritureRow[];
}

export interface VentilationInput {
  montant: string;
  natureId: string;
  activiteId: string;
  brancheprojetId: string;
}

export interface CreateEcritureInput {
  type: EcritureType;
  libel: string;
  dateecriture: string;
  montant: string;
  numeropiece?: string;
  modetransactionId: string;
  comptebancaireId?: string;
  chequierId?: string;
  chequenumValue?: string;
  cartebancaireId?: string;
  carteprocurementId?: string;
  caisseId?: string;
  tiersCategId: string;
  tiersStructureId: string;
  ventilations: VentilationInput[];
}

export interface CreateEcritureResult {
  dryRun: boolean;
  ecritureId?: number;
  detailsPath?: string;
  postBody?: Record<string, string>;
  warnings: string[];
}
