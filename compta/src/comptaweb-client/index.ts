export { loadConfig, forceReLogin, withAutoReLogin } from './auth.js';
export { fetchHtml, ComptawebSessionExpiredError } from './http.js';
export { listRapprochementBancaire, parseRapprochementHtml } from './ecritures-bancaires.js';
export { fetchReferentielsCreer, createEcriture } from './ecritures-write.js';
export { createEcritureFromLigneBancaire } from './ecritures-from-bancaire.js';
export { applyReferentielsSync } from './sync-referentiels-logic.js';
export type {
  SyncReferentielsReport,
  RefSyncStats,
  ReferentielsInput,
} from './sync-referentiels-logic.js';
export type {
  ComptawebConfig,
  EcritureBancaireNonRapprochee,
  EcritureComptableNonRapprochee,
  RapprochementBancaireData,
  SousLigneDsp2,
  ReferentielsCreerEcriture,
  RefOption,
  EcritureType,
  VentilationInput,
  CreateEcritureInput,
  CreateEcritureResult,
} from './types.js';
