// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : ce client Comptaweb est
// dupliqué à l'identique dans `web/src/lib/comptaweb/` (~1000 lignes). La
// version `web/` est la canonique : c'est elle qui sera intégrée à l'API
// HTTP de la webapp en P2 (cf. roadmap.md). Au chantier 3, quand le MCP
// devient un client HTTP de cette API, ce répertoire deviendra obsolète et
// pourra être supprimé. En attendant, on conserve les deux copies pour ne
// rien casser.

export { loadConfig, forceReLogin, withAutoReLogin } from './auth.js';
export { fetchHtml, ComptawebSessionExpiredError } from './http.js';
export { listRapprochementBancaire, parseRapprochementHtml } from './ecritures-bancaires.js';
export { fetchReferentielsCreer, createEcriture } from './ecritures-write.js';
export { createEcritureFromLigneBancaire } from './ecritures-from-bancaire.js';
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
