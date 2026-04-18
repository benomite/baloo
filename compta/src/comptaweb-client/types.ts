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
