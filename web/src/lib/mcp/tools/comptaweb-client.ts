import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../auth';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  fetchReferentielsCreer,
} from '@/lib/comptaweb';
import { formatAmount } from '@/lib/format';

// NB : seuls les tools de LECTURE sont exposés côté MCP.
// La création/modification d'écritures dans Comptaweb est réservée à l'UI.
//
// Sont portés ici :
//  - cw_list_rapprochement_bancaire (lecture)
//  - cw_referentiels_creer_ecriture (lecture)
export function registerComptawebClientTools(server: McpServer, _ctx: McpContext) {
  void _ctx; // pas utilisé : opérations CW non multi-tenant côté MCP

  server.tool(
    'cw_list_rapprochement_bancaire',
    "Lit la page de rapprochement bancaire de Comptaweb et renvoie les écritures comptables non rapprochées et les écritures bancaires non rapprochées (avec leurs sous-lignes DSP2). Nécessite un cookie de session valide côté serveur webapp.",
    {},
    async () => {
      const data = await withAutoReLogin((cfg) => listRapprochementBancaire(cfg));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
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
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'cw_referentiels_creer_ecriture',
    "Renvoie les référentiels nécessaires pour créer une écriture dans Comptaweb (devises, modes de transaction, comptes, tiers, natures, activités, branches). Utile en lecture seule pour debug ou pour connaître les IDs de ventilation.",
    {},
    async () => {
      const refs = await withAutoReLogin((cfg) => fetchReferentielsCreer(cfg));
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                depenserecette: refs.depenserecette,
                devise: refs.devise,
                modetransaction: refs.modetransaction,
                comptebancaire: refs.comptebancaire,
                chequier: refs.chequier,
                cartebancaire: refs.cartebancaire,
                carteprocurement: refs.carteprocurement,
                caisse: refs.caisse,
                tierscateg: refs.tierscateg,
                tiersstructure: refs.tiersstructure,
                nature: refs.nature,
                activite: refs.activite,
                brancheprojet: refs.brancheprojet,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

}
