import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatAmount } from '../db.js';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  ComptawebSessionExpiredError,
} from '../comptaweb-client/index.js';

export function registerComptawebClientTools(server: McpServer) {
  server.tool(
    'cw_list_rapprochement_bancaire',
    "Lit la page de rapprochement bancaire de Comptaweb et renvoie les écritures comptables non rapprochées et les écritures bancaires non rapprochées (avec leurs sous-lignes DSP2 quand elles existent). Nécessite un cookie de session valide dans compta/.env.",
    {},
    async () => {
      try {
        const data = await withAutoReLogin((config) => listRapprochementBancaire(config));
        const payload = {
          compte: { id: data.idCompte, libelle: data.libelleCompte },
          ecritures_comptables_non_rapprochees: data.ecrituresComptables.map((e) => ({
            id: e.id,
            date_ecriture: e.dateEcriture,
            type: e.type,
            intitule: e.intitule,
            devise: e.devise,
            montant: formatAmount(e.montantCentimes),
            montant_centimes: e.montantCentimes,
            numero_piece: e.numeroPiece,
            mode_transaction: e.modeTransaction,
            tiers: e.tiers,
          })),
          ecritures_bancaires_non_rapprochees: data.ecrituresBancaires.map((e) => ({
            id: e.id,
            date_operation: e.dateOperation,
            intitule: e.intitule,
            montant: formatAmount(e.montantCentimes),
            montant_centimes: e.montantCentimes,
            sous_lignes: e.sousLignes.map((sl) => ({
              montant: formatAmount(sl.montantCentimes),
              montant_centimes: sl.montantCentimes,
              commercant: sl.commercant,
            })),
          })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        if (err instanceof ComptawebSessionExpiredError) {
          return {
            content: [
              {
                type: 'text',
                text: "Session Comptaweb expirée et re-login automatique impossible. Vérifier COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD dans compta/.env.",
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur Comptaweb : ${msg}` }], isError: true };
      }
    }
  );
}
