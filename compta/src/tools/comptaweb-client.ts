import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

interface CreateEcritureResultPayload {
  dryRun: boolean;
  ecritureId?: number;
  detailsPath?: string;
  postBody?: Record<string, string>;
  warnings: string[];
}

interface FromBancaireResultPayload extends CreateEcritureResultPayload {
  sourceLigneId: number;
  sourceSousLigneIndex: number | null;
  sourceMontantCentimes: number;
  inferredModetransactionId: string;
}

const ventilationSchema = z.object({
  montant: z.string().describe("Format '12,34' ou '12.34'"),
  nature_id: z.string(),
  activite_id: z.string(),
  brancheprojet_id: z.string(),
});

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
  dry_run: z.boolean().optional().describe("Si true (défaut), n'envoie pas la requête et retourne le body qui serait posté."),
};

type CreateArgs = {
  libel: string;
  dateecriture: string;
  montant: string;
  modetransaction_id: string;
  comptebancaire_id?: string;
  chequier_id?: string;
  chequenum_value?: string;
  cartebancaire_id?: string;
  carteprocurement_id?: string;
  caisse_id?: string;
  tiers_categ_id: string;
  tiers_structure_id: string;
  numeropiece?: string;
  ventilations: Array<z.infer<typeof ventilationSchema>>;
  dry_run?: boolean;
};

function buildBody(args: CreateArgs, type: 'depense' | 'recette') {
  return {
    type,
    libel: args.libel,
    dateecriture: args.dateecriture,
    montant: args.montant,
    numeropiece: args.numeropiece,
    modetransactionId: args.modetransaction_id,
    comptebancaireId: args.comptebancaire_id,
    chequierId: args.chequier_id,
    chequenumValue: args.chequenum_value,
    cartebancaireId: args.cartebancaire_id,
    carteprocurementId: args.carteprocurement_id,
    caisseId: args.caisse_id,
    tiersCategId: args.tiers_categ_id,
    tiersStructureId: args.tiers_structure_id,
    ventilations: args.ventilations.map((v) => ({
      montant: v.montant,
      natureId: v.nature_id,
      activiteId: v.activite_id,
      brancheprojetId: v.brancheprojet_id,
    })),
    dryRun: args.dry_run !== false,
  };
}

function formatCreateResult(result: CreateEcritureResultPayload, type: string) {
  if (result.dryRun) {
    const bodyPreview = result.postBody
      ? Object.entries(result.postBody).map(([k, v]) => `  ${k} = ${v}`).join('\n')
      : '';
    const warn = result.warnings.length ? `\n⚠ ${result.warnings.join('; ')}` : '';
    return {
      content: [{ type: 'text' as const, text: `DRY-RUN ${type} — aucune requête envoyée.${warn}\nBody qui serait posté :\n${bodyPreview}\n\nPour créer pour de vrai, rappeler avec dry_run=false.` }],
    };
  }
  return {
    content: [{ type: 'text' as const, text: `✓ Écriture ${type} créée : ID ${result.ecritureId} (${result.detailsPath}).` }],
  };
}

export function registerComptawebClientTools(server: McpServer) {
  server.tool(
    'cw_list_rapprochement_bancaire',
    "Lit la page de rapprochement bancaire de Comptaweb et renvoie les écritures comptables non rapprochées et les écritures bancaires non rapprochées (avec leurs sous-lignes DSP2). Nécessite un cookie de session valide côté serveur webapp.",
    {},
    async () => {
      const data = await api.get('/api/comptaweb/rapprochement-bancaire');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cw_referentiels_creer_ecriture',
    "Renvoie les référentiels nécessaires pour créer une écriture dans Comptaweb (devises, modes de transaction, comptes, tiers, natures, activités, branches). À appeler avant cw_create_depense/_recette pour connaître les IDs valides.",
    {},
    async () => {
      const data = await api.get('/api/comptaweb/referentiels-creer');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cw_create_depense',
    "Crée une écriture de dépense dans Comptaweb. Dry-run par défaut : passer dry_run=false pour écrire réellement. Toujours appeler cw_referentiels_creer_ecriture d'abord pour connaître les IDs valides.",
    createSchema,
    async (args) => {
      const result = await api.post<CreateEcritureResultPayload>(
        '/api/comptaweb/ecriture',
        buildBody(args, 'depense'),
      );
      return formatCreateResult(result, 'depense');
    },
  );

  server.tool(
    'cw_create_recette',
    "Crée une écriture de recette dans Comptaweb. Dry-run par défaut : passer dry_run=false pour écrire réellement.",
    createSchema,
    async (args) => {
      const result = await api.post<CreateEcritureResultPayload>(
        '/api/comptaweb/ecriture',
        buildBody(args, 'recette'),
      );
      return formatCreateResult(result, 'recette');
    },
  );

  server.tool(
    'cw_ecriture_depuis_ligne_bancaire',
    "Crée une écriture Comptaweb à partir d'une ligne bancaire non rapprochée (workflow d'enrichissement). Le libellé, la date, le montant, le type (dépense/recette) et le mode de transaction sont inférés. L'utilisateur complète obligatoirement nature/activité/branche (ventilation). Dry-run par défaut.",
    {
      ligne_bancaire_id: z.number().describe("ID de la ligne bancaire (cf. cw_list_rapprochement_bancaire)"),
      sous_ligne_index: z.number().int().min(0).optional().describe("Index 0-based de la sous-ligne DSP2 à utiliser. Si omis, ligne principale."),
      nature_id: z.string().describe("ID de la nature comptable (cf. cw_referentiels_creer_ecriture)"),
      activite_id: z.string(),
      brancheprojet_id: z.string(),
      libel_override: z.string().optional().describe("Si absent, libellé inféré depuis le commerçant ou l'intitulé bancaire."),
      modetransaction_id_override: z.string().optional().describe("Si absent, mode inféré depuis l'intitulé (VIR, PAIEMENT C. PROC, etc.)"),
      numeropiece: z.string().optional(),
      tiers_categ_id: z.string().optional().describe("Défaut '10' = 'Autre : pas structure SGDF' (fournisseur externe). Passer '4' (Mon groupe) seulement pour un mouvement interne."),
      tiers_structure_id: z.string().optional().describe("Défaut '' (aucune, car catég 'Autre'). À renseigner uniquement si tiers_categ_id désigne une structure SGDF."),
      dry_run: z.boolean().optional().describe("Défaut true. Passer false pour créer réellement."),
    },
    async (args) => {
      const result = await api.post<FromBancaireResultPayload>(
        '/api/comptaweb/ecriture-from-bancaire',
        {
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
        },
      );
      const header = `Ligne source: ${result.sourceLigneId}${result.sourceSousLigneIndex !== null ? ` (sous-ligne ${result.sourceSousLigneIndex})` : ''}, montant ${result.sourceMontantCentimes} centimes, mode inféré: ${result.inferredModetransactionId}.`;
      if (result.dryRun) {
        const body = result.postBody
          ? Object.entries(result.postBody).map(([k, v]) => `  ${k} = ${v}`).join('\n')
          : '';
        const warn = result.warnings.length ? `\n⚠ ${result.warnings.join('; ')}` : '';
        return {
          content: [{ type: 'text', text: `DRY-RUN — aucune requête envoyée.\n${header}${warn}\n\nBody qui serait posté :\n${body}\n\nPour créer, rappeler avec dry_run=false.` }],
        };
      }
      return {
        content: [{ type: 'text', text: `✓ Écriture créée : ID ${result.ecritureId} (${result.detailsPath}).\n${header}` }],
      };
    },
  );
}
