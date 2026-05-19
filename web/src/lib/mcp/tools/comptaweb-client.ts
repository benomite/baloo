import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  fetchReferentielsCreer,
} from '@/lib/comptaweb';
import { createEcritureFromLigneBancaire } from '@/lib/comptaweb/ecritures-from-bancaire';
import { formatAmount } from '@/lib/format';

// NB Phase 1 : `cw_create_depense` et `cw_create_recette` NE SONT PAS
// portés côté MCP HTTP (décisions actées dans le brief Task 2).
// Ils sont doublonnent fonctionnellement `create_ecriture` qui pilote
// désormais le cycle pending_cw → pending_sync via
// `createEcritureAndPushToCw`. Un agent qui voudrait écrire directement
// dans CW sans miroir Baloo doit passer par le UI admin, pas par MCP.
//
// Sont portés ici :
//  - cw_list_rapprochement_bancaire (lecture)
//  - cw_referentiels_creer_ecriture (lecture)
//  - cw_ecriture_depuis_ligne_bancaire (workflow enrichissement, utile
//    pour cleanup ligne bancaire non rapprochée → écriture CW)
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
    "Renvoie les référentiels nécessaires pour créer une écriture dans Comptaweb (devises, modes de transaction, comptes, tiers, natures, activités, branches). Utile en lecture seule pour debug — la création passe par `create_ecriture`.",
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

  server.tool(
    'cw_ecriture_depuis_ligne_bancaire',
    "Crée une écriture Comptaweb à partir d'une ligne bancaire non rapprochée (workflow d'enrichissement). Le libellé, la date, le montant, le type (dépense/recette) et le mode de transaction sont inférés. L'utilisateur complète obligatoirement nature/activité/branche (ventilation). Dry-run par défaut.",
    {
      ligne_bancaire_id: z.number().describe('ID de la ligne bancaire (cf. cw_list_rapprochement_bancaire)'),
      sous_ligne_index: z.number().int().min(0).optional().describe('Index 0-based de la sous-ligne DSP2 à utiliser. Si omis, ligne principale.'),
      nature_id: z.string().describe('ID de la nature comptable (cf. cw_referentiels_creer_ecriture)'),
      activite_id: z.string(),
      brancheprojet_id: z.string(),
      libel_override: z.string().optional().describe("Si absent, libellé inféré depuis le commerçant ou l'intitulé bancaire."),
      modetransaction_id_override: z.string().optional().describe("Si absent, mode inféré depuis l'intitulé (VIR, PAIEMENT C. PROC, etc.)"),
      numeropiece: z.string().optional(),
      tiers_categ_id: z.string().optional().describe("Défaut '10' = 'Autre : pas structure SGDF' (fournisseur externe). Passer '4' (Mon groupe) seulement pour un mouvement interne."),
      tiers_structure_id: z.string().optional().describe("Défaut '' (aucune, car catég 'Autre'). À renseigner uniquement si tiers_categ_id désigne une structure SGDF."),
      dry_run: z.boolean().optional().describe('Défaut true. Passer false pour créer réellement.'),
    },
    async (args) => {
      const result = await withAutoReLogin((cfg) =>
        createEcritureFromLigneBancaire(cfg, {
          ligneBancaireId: args.ligne_bancaire_id,
          sousLigneIndex: args.sous_ligne_index,
          ventilation: {
            montant: '',
            natureId: args.nature_id,
            activiteId: args.activite_id,
            brancheprojetId: args.brancheprojet_id,
          },
          libelOverride: args.libel_override,
          modetransactionIdOverride: args.modetransaction_id_override,
          numeropiece: args.numeropiece,
          tiersCategId: args.tiers_categ_id,
          tiersStructureId: args.tiers_structure_id,
          dryRun: args.dry_run !== false,
        }),
      );

      const header = `Ligne source: ${result.sourceLigneId}${result.sourceSousLigneIndex !== null ? ` (sous-ligne ${result.sourceSousLigneIndex})` : ''}, montant ${result.sourceMontantCentimes} centimes, mode inféré: ${result.inferredModetransactionId}.`;
      if (result.dryRun) {
        const body = result.postBody
          ? Object.entries(result.postBody)
              .map(([k, v]) => `  ${k} = ${v}`)
              .join('\n')
          : '';
        const warn = result.warnings.length ? `\nAttention : ${result.warnings.join('; ')}` : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `DRY-RUN — aucune requête envoyée.\n${header}${warn}\n\nBody qui serait posté :\n${body}\n\nPour créer, rappeler avec dry_run=false.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Écriture créée : ID ${result.ecritureId} (${result.detailsPath}).\n${header}`,
          },
        ],
      };
    },
  );
}
