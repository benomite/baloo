import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatAmount } from '../db.js';
import {
  withAutoReLogin,
  listRapprochementBancaire,
  fetchReferentielsCreer,
  createEcriture,
  createEcritureFromLigneBancaire,
  ComptawebSessionExpiredError,
} from '../comptaweb-client/index.js';
import type { CreateEcritureInput, EcritureType } from '../comptaweb-client/index.js';

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

  server.tool(
    'cw_referentiels_creer_ecriture',
    "Renvoie les référentiels nécessaires pour créer une écriture dans Comptaweb (devises, modes de transaction, comptes, tiers, natures, activités, branches). À appeler avant cw_create_depense/_recette pour connaître les IDs valides.",
    {},
    async () => {
      try {
        const refs = await withAutoReLogin((cfg) => fetchReferentielsCreer(cfg));
        const payload = {
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
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur : ${msg}` }], isError: true };
      }
    }
  );

  const ventilationSchema = z.object({
    montant: z.string().describe("Format '12,34' ou '12.34'"),
    nature_id: z.string(),
    activite_id: z.string(),
    brancheprojet_id: z.string(),
  });

  function buildInputFromArgs(args: Record<string, unknown>, type: EcritureType): CreateEcritureInput {
    const ventilations = (args.ventilations as Array<z.infer<typeof ventilationSchema>>).map((v) => ({
      montant: v.montant,
      natureId: v.nature_id,
      activiteId: v.activite_id,
      brancheprojetId: v.brancheprojet_id,
    }));
    return {
      type,
      libel: args.libel as string,
      dateecriture: args.dateecriture as string,
      montant: args.montant as string,
      numeropiece: args.numeropiece as string | undefined,
      modetransactionId: args.modetransaction_id as string,
      comptebancaireId: args.comptebancaire_id as string | undefined,
      chequierId: args.chequier_id as string | undefined,
      chequenumValue: args.chequenum_value as string | undefined,
      cartebancaireId: args.cartebancaire_id as string | undefined,
      carteprocurementId: args.carteprocurement_id as string | undefined,
      caisseId: args.caisse_id as string | undefined,
      tiersCategId: args.tiers_categ_id as string,
      tiersStructureId: args.tiers_structure_id as string,
      ventilations,
    };
  }

  const createSchema = {
    libel: z.string().min(1).describe("Intitulé de l'écriture"),
    dateecriture: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).describe("Date au format DD/MM/YYYY"),
    montant: z.string().describe("Montant total, ex: '12,34'"),
    modetransaction_id: z.string().describe("ID du mode de transaction (cf. cw_referentiels_creer_ecriture)"),
    comptebancaire_id: z.string().optional(),
    chequier_id: z.string().optional(),
    chequenum_value: z.string().optional(),
    cartebancaire_id: z.string().optional(),
    carteprocurement_id: z.string().optional(),
    caisse_id: z.string().optional(),
    tiers_categ_id: z.string(),
    tiers_structure_id: z.string(),
    numeropiece: z.string().optional().describe("Numéro de pièce (peut servir à stocker l'ID du justificatif Baloo, ex: JUS-2026-001)"),
    ventilations: z.array(ventilationSchema).min(1).describe("Au moins une ventilation. La somme des montants doit égaler le montant total."),
    dry_run: z.boolean().optional().describe("Si true (défaut), n'envoie pas la requête et retourne le body qui serait posté. Passer false pour créer réellement."),
  };

  function formatCreateResult(result: Awaited<ReturnType<typeof createEcriture>>, type: EcritureType) {
    if (result.dryRun) {
      const bodyPreview = result.postBody ? Object.entries(result.postBody).map(([k, v]) => `  ${k} = ${v}`).join('\n') : '';
      const warn = result.warnings.length ? `\n⚠ ${result.warnings.join('; ')}` : '';
      return {
        content: [{ type: 'text' as const, text: `DRY-RUN ${type} — aucune requête envoyée.${warn}\nBody qui serait posté :\n${bodyPreview}\n\nPour créer pour de vrai, rappeler avec dry_run=false.` }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: `✓ Écriture ${type} créée : ID ${result.ecritureId} (${result.detailsPath}).` }],
    };
  }

  server.tool(
    'cw_create_depense',
    "Crée une écriture de dépense dans Comptaweb. Dry-run par défaut : passer dry_run=false pour écrire réellement. Toujours appeler cw_referentiels_creer_ecriture d'abord pour connaître les IDs valides.",
    createSchema,
    async (args) => {
      try {
        const input = buildInputFromArgs(args as Record<string, unknown>, 'depense');
        const result = await withAutoReLogin((cfg) => createEcriture(cfg, input, { dryRun: args.dry_run !== false }));
        return formatCreateResult(result, 'depense');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur : ${msg}` }], isError: true };
      }
    }
  );

  server.tool(
    'cw_ecriture_depuis_ligne_bancaire',
    "Crée une écriture Comptaweb à partir d'une ligne bancaire non rapprochée (workflow d'enrichissement). Le libellé, la date, le montant, le type (dépense/recette) et le mode de transaction sont inférés. L'utilisateur complète obligatoirement nature/activité/branche (ventilation). Dry-run par défaut.",
    {
      ligne_bancaire_id: z.number().describe("ID de la ligne bancaire (cf. cw_list_rapprochement_bancaire)"),
      sous_ligne_index: z.number().int().min(0).optional().describe("Index 0-based de la sous-ligne DSP2 à utiliser (pour les paiements carte multi-commerçants). Si omis, utilise la ligne principale."),
      nature_id: z.string().describe("ID de la nature comptable (cf. cw_referentiels_creer_ecriture)"),
      activite_id: z.string(),
      brancheprojet_id: z.string(),
      libel_override: z.string().optional().describe("Si absent, libellé inféré depuis le commerçant ou l'intitulé bancaire."),
      modetransaction_id_override: z.string().optional().describe("Si absent, mode inféré depuis l'intitulé (VIR, PAIEMENT C. PROC, etc.)"),
      numeropiece: z.string().optional(),
      tiers_categ_id: z.string().optional().describe("Défaut '4' = Mon groupe"),
      tiers_structure_id: z.string().optional().describe("Défaut '498' (structure du groupe courant)"),
      dry_run: z.boolean().optional().describe("Défaut true. Passer false pour créer réellement."),
    },
    async (args) => {
      try {
        const result = await withAutoReLogin((cfg) =>
          createEcritureFromLigneBancaire(cfg, {
            ligneBancaireId: args.ligne_bancaire_id,
            sousLigneIndex: args.sous_ligne_index,
            ventilation: {
              montant: '', // sera ignoré : rempli par l'orchestrateur depuis la ligne
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
          const body = result.postBody ? Object.entries(result.postBody).map(([k, v]) => `  ${k} = ${v}`).join('\n') : '';
          const warn = result.warnings.length ? `\n⚠ ${result.warnings.join('; ')}` : '';
          return {
            content: [{ type: 'text', text: `DRY-RUN — aucune requête envoyée.\n${header}${warn}\n\nBody qui serait posté :\n${body}\n\nPour créer, rappeler avec dry_run=false.` }],
          };
        }
        return {
          content: [{ type: 'text', text: `✓ Écriture créée : ID ${result.ecritureId} (${result.detailsPath}).\n${header}` }],
        };
      } catch (err) {
        if (err instanceof ComptawebSessionExpiredError) {
          return { content: [{ type: 'text', text: 'Session expirée.' }], isError: true };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur : ${msg}` }], isError: true };
      }
    }
  );

  server.tool(
    'cw_create_recette',
    "Crée une écriture de recette dans Comptaweb. Dry-run par défaut : passer dry_run=false pour écrire réellement.",
    createSchema,
    async (args) => {
      try {
        const input = buildInputFromArgs(args as Record<string, unknown>, 'recette');
        const result = await withAutoReLogin((cfg) => createEcriture(cfg, input, { dryRun: args.dry_run !== false }));
        return formatCreateResult(result, 'recette');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Erreur : ${msg}` }], isError: true };
      }
    }
  );
}
