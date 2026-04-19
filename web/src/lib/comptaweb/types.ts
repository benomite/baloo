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
