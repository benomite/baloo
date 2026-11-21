import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listEcritures, updateEcriture, batchUpdateEcritures } from '@/lib/services/ecritures';
import { ventilateDraft, VENTILATE_MESSAGES } from '@/lib/services/ecritures-ventilate';
import { fusionnerBrouillons } from '@/lib/services/ecritures-fusion';
import { ECRITURE_STATUSES, ECRITURE_TYPES, MODES_TRANSFERT, type EcritureStatus } from '@/lib/types';
import { pendingStatuses } from '@/lib/services/ecritures-status';
import { parseAmount } from '@/lib/format';

const ECRITURE_STATUS_ENUM = z.enum(ECRITURE_STATUSES);

export function registerEcrituresTools(server: McpServer, ctx: McpContext) {
  const ecritureCtx = { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds };

  // ─── list_ecritures (étendu) ───────────────────────────────────────────
  //
  // Surface étendue par rapport à la version Phase 1 initiale : ajoute
  // `status` (string ou tableau), `carte_id`, `mode_paiement_id`,
  // `comptaweb_ecriture_id`, `pending_only`. La sémantique de
  // `unmatched_only` historique a été remplacée par `pending_only` :
  // utilise les statuts pending (draft/pending_cw/pending_sync) au
  // lieu de l'ancien flag comptaweb_synced=0.
  server.tool(
    'list_ecritures',
    'Liste les écritures comptables, filtrables par type, période, statut, catégorie, mode de paiement, carte, ID Comptaweb. Par défaut, renvoie tous statuts confondus sauf les brouillons absorbés par une fusion (`status: "fusionne"` pour les voir, avec `fusionne_dans_id`) ; ajuste avec `status` ou `pending_only`. Chaque écriture porte `titre_a_renommer` (1 = la description est encore le libellé bancaire brut, à personnaliser via update_ecriture) et `libelle_origine` (le libellé bancaire brut figé).',
    {
      type: z.enum(ECRITURE_TYPES).optional(),
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      category_id: z.string().optional(),
      unite_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      carte_id: z.string().optional(),
      status: z
        .union([ECRITURE_STATUS_ENUM, z.array(ECRITURE_STATUS_ENUM).min(1)])
        .optional()
        .describe('Filtre par statut (valeur ou liste). Ex: ["draft","pending_cw"]'),
      comptaweb_ecriture_id: z.number().int().optional(),
      pending_only: z
        .boolean()
        .optional()
        .describe(
          'Si true : ne renvoie que les écritures pending (draft / pending_cw / pending_sync), ' +
            "remplace l'ancien filtre unmatched_only (qui regardait comptaweb_synced=0).",
        ),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).optional(),
    },
    async (params) => {
      const { status, comptaweb_ecriture_id, pending_only, ...rest } = params;
      let statusIn: string[] | undefined;
      let statusSingle: string | undefined;
      if (Array.isArray(status)) statusIn = status;
      else if (status) statusSingle = status;
      if (pending_only) statusIn = pendingStatuses();

      const filters = {
        ...rest,
        status: statusSingle,
        statusIn,
      };

      const result = await listEcritures(ecritureCtx, filters);

      // Filtre post-query sur comptaweb_ecriture_id (pas exposé en filter
      // direct côté service mais simple à appliquer ici — usage MCP/audit).
      const ecritures = comptaweb_ecriture_id
        ? result.ecritures.filter(
            (e) => (e as { comptaweb_ecriture_id?: number | null }).comptaweb_ecriture_id === comptaweb_ecriture_id,
          )
        : result.ecritures;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ecritures,
                total: comptaweb_ecriture_id ? ecritures.length : result.total,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── update_ecriture ──────────────────────────────────────────────────
  //
  // Édition d'une écriture EXISTANTE. On expose les champs d'imputation
  // (category_id, unite_id, activite_id, mode_paiement_id, carte_id, date,
  // montant, libellé, type, numero_piece) EN PLUS des champs Baloo-only
  // (notes, justif_attendu). C'est délégué au service `updateEcriture`, qui
  // applique le verrou miroir : tant que l'écriture est un brouillon (status
  // non mirror), tout est modifiable sans toucher Comptaweb ; une fois dans
  // CW (mirror/divergent), les champs miroir sont silencieusement ignorés et
  // seuls notes/justif_attendu passent. `status`/`comptaweb_synced` restent
  // NON exposés (réservés aux flux internes de sync).
  //
  // Régression historique corrigée : la whitelist ne portait QUE sur
  // notes+justif_attendu, rendant impossible la catégorisation d'un draft
  // via MCP — un agent sommé de « catégoriser » se rabattait sur
  // create_ecriture (push CW) et créait des doublons.
  server.tool(
    'update_ecriture',
    [
      "Met à jour une écriture EXISTANTE. À utiliser pour catégoriser / imputer / corriger un brouillon (draft) :",
      'tant que l\'écriture n\'est pas dans Comptaweb, tous les champs (nature/catégorie, unité, activité, mode de paiement,',
      'carte, date, montant, libellé, type, n° pièce) sont modifiables — un simple UPDATE local, AUCUN envoi vers Comptaweb.',
      "Ne crée RIEN : la création d'écriture dans Comptaweb est réservée à l'UI.",
      'Une fois l\'écriture dans Comptaweb (mirror/divergent), ces champs deviennent la source de vérité Comptaweb et sont',
      'silencieusement ignorés ici ; seuls notes et justif_attendu (champs Baloo-only) restent modifiables. Pour corriger',
      'une écriture déjà dans CW, modifie côté Comptaweb et la sync Baloo reflétera.',
      'IMPORTANT — TITRE : si list_ecritures renvoie `titre_a_renommer: 1`, la `description` est encore le libellé bancaire',
      'BRUT (ex. « PAIEMENT C. PROC … FR FRANCE ») jamais personnalisé. Renseigner un titre parlant (ce qui a été payé / la',
      'famille / l\'objet) via `description` est une étape importante du nettoyage compta — non bloquante, mais à PROPOSER',
      'systématiquement quand tu traites un brouillon. Ce titre partira tel quel dans Comptaweb à la validation.',
      'TRANSFERT INTERNE : un brouillon bancaire qui est un dépôt d\'espèces en banque, un retrait d\'espèces ou un',
      'transfert d\'espèces n\'est ni une dépense ni une recette — qualifie-le avec `type: "transfert_interne"` et',
      '`mode_transfert` (depot_especes / retrait_especes / transfert_especes). Il ne demande alors ni catégorie, ni',
      'unité, ni activité, ni mode de paiement, ni justificatif, et sort des totaux. Lie-le ensuite à la caisse :',
      'rapprocher_depot_especes (dépôt) ou rapprocher_retrait_especes (retrait), ou crée l\'opération avec',
      'create_depot_especes / create_retrait_especes en passant `ecriture_id`.',
    ].join(' '),
    {
      id: z.string().describe('ID de l\'écriture (ex: DEP-2026-001 ou REC-2026-005)'),
      // Champs d'imputation : appliqués SEULEMENT si l'écriture est un brouillon
      // (status non mirror) — le service updateEcriture les ignore en mirror.
      category_id: z.string().optional().describe('Nature / catégorie comptable (cf. list_categories).'),
      unite_id: z.string().optional(),
      activite_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      carte_id: z.string().optional(),
      numero_piece: z.string().optional(),
      date_ecriture: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date (YYYY-MM-DD)'),
      description: z.string().min(1).optional(),
      amount_cents: z.number().int().optional(),
      montant: z.string().optional().describe('Alternative à amount_cents : montant formaté FR (ex: "42,50").'),
      type: z.enum(ECRITURE_TYPES).optional(),
      mode_transfert: z
        .enum(MODES_TRANSFERT)
        .nullable()
        .optional()
        .describe('Mode du transfert interne (avec type="transfert_interne") : dépôt, retrait ou transfert d\'espèces.'),
      // Champs Baloo-only : modifiables quel que soit le statut.
      notes: z.string().nullable().optional(),
      justif_attendu: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    },
    async (params) => {
      const { id, montant, ...rest } = params;
      const patch: Parameters<typeof updateEcriture>[2] = { ...rest };
      // `montant` (FR) est un alias d'amount_cents ; on ne convertit que si
      // amount_cents n'a pas été fourni explicitement.
      if (patch.amount_cents === undefined && montant) {
        patch.amount_cents = parseAmount(montant);
      }
      const updated = await updateEcriture(ecritureCtx, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Écriture ${id} introuvable.` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                ecriture: {
                  id: updated.id,
                  status: updated.status as EcritureStatus,
                  type: updated.type,
                  mode_transfert: updated.mode_transfert ?? null,
                  category_id: updated.category_id,
                  unite_id: updated.unite_id,
                  activite_id: updated.activite_id,
                  mode_paiement_id: updated.mode_paiement_id,
                  carte_id: updated.carte_id,
                  notes: updated.notes,
                  justif_attendu: updated.justif_attendu,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── batch_update_ecritures ───────────────────────────────────────────
  //
  // Édition en masse d'un lot d'écritures. Reflète `batchUpdateEcritures`
  // (service), qui filtre silencieusement les écritures miroir (mirror /
  // divergent) — seules les écritures modifiables (draft / pending_cw /
  // pending_sync) sont mises à jour. Cohérent avec ADR-037 / update_ecriture.
  // Pas de champ `status` ni de push CW.
  server.tool(
    'batch_update_ecritures',
    [
      "Met à jour en masse un lot d'écritures (imputation : catégorie, unité, activité, mode de paiement, carte, justif_attendu).",
      'Seules les écritures modifiables (draft / pending_cw / pending_sync) sont affectées ;',
      'les écritures déjà dans Comptaweb (mirror / divergent) sont silencieusement ignorées (skipped).',
      'Pas de push Comptaweb — identique à update_ecriture, mais sur plusieurs écritures à la fois.',
    ].join(' '),
    {
      ids: z.array(z.string()).min(1).describe('Liste des IDs d\'écritures à mettre à jour.'),
      patch: z.object({
        category_id: z.string().nullable().optional(),
        unite_id: z.string().nullable().optional(),
        activite_id: z.string().nullable().optional(),
        mode_paiement_id: z.string().nullable().optional(),
        carte_id: z.string().nullable().optional(),
        justif_attendu: z.union([z.literal(0), z.literal(1)]).optional(),
      }).describe('Champs à mettre à jour (seuls les champs fournis sont modifiés).'),
    },
    async ({ ids, patch }) => {
      const result = await batchUpdateEcritures(ecritureCtx, ids, patch);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
  // ─── ventiler_ecriture ────────────────────────────────────────────────
  //
  // Éclatement d'un brouillon en N ventilations (parité MCP ↔ app,
  // ADR-038 : l'app le fait depuis /inbox depuis 2026-07, le MCP pas
  // encore — d'où ce tool). Délègue à `ventilateDraft`, le MÊME service
  // que la route `PUT /api/ecritures/[id]/ventilations`, donc mêmes
  // garde-fous : brouillon uniquement, Σ des lignes == total de la tête,
  // refus si une ligne à retirer porte une pièce. L'opération est
  // PUREMENT LOCALE — aucun push Comptaweb (cf. ADR-037) : la
  // matérialisation reste une action humaine dans l'UI.
  server.tool(
    'ventiler_ecriture',
    [
      "Éclate un brouillon (draft) en PLUSIEURS ventilations : un même mouvement bancaire réparti sur",
      'plusieurs imputations (ex. 300 € payés par une famille = 150 € LJ + 150 € SG, ou une dépense',
      "unique = 150 € Hébergement + 100 € Petit matériel). La somme des ventilations DOIT être égale au",
      "montant total de l'écriture — sinon le tool refuse (garde-fou anti perte/gain d'argent).",
      "L'écriture de tête garde son id, ses justificatifs, ses notes et son identité bancaire ; les",
      'lignes suivantes sont créées et rattachées au même groupe de ventilation.',
      "Opération PUREMENT LOCALE : aucun envoi vers Comptaweb (la validation reste une action humaine dans l'app).",
      "Ne marche que sur un brouillon : une écriture déjà dans Comptaweb n'est pas ventilable ici.",
      "Repasser UNE seule ventilation refusionne le groupe (annule un découpage) — pratique pour corriger une erreur.",
      "L'imputation (catégorie / unité / activité) peut être laissée vide et complétée ensuite via update_ecriture.",
    ].join(' '),
    {
      id: z.string().describe("ID de l'écriture à ventiler (la tête du groupe, ex: ECR-2026-123)."),
      ventilations: z
        .array(
          z.object({
            montant: z.string().describe('Montant au format français, ex: "150,00".'),
            category_id: z.string().nullish().describe('Nature / catégorie comptable (cf. list_categories).'),
            unite_id: z.string().nullish().describe('Unité bénéficiaire (cf. list_unites).'),
            activite_id: z.string().nullish().describe('Activité (cf. list_activites).'),
          }),
        )
        .min(1)
        .describe('Les lignes de détail. Leur somme doit égaler le montant total de l\'écriture.'),
    },
    async ({ id, ventilations }) => {
      const lignes = ventilations.map((v) => ({
        amount_cents: parseAmount(v.montant),
        category_id: v.category_id ?? null,
        unite_id: v.unite_id ?? null,
        activite_id: v.activite_id ?? null,
      }));
      const result = await ventilateDraft(ecritureCtx, id, lignes);
      if (!result.ok && result.reason) {
        return { content: [{ type: 'text' as const, text: VENTILATE_MESSAGES[result.reason] }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ok: true, ventilation_group_id: result.ventilation_group_id ?? null, ids: result.ids ?? [] },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── fusionner_brouillons ─────────────────────────────────────────────
  //
  // Ticket #49 : une famille paie une même chose en plusieurs virements → un
  // brouillon par ligne bancaire, une seule écriture en compta. Délègue à
  // `fusionnerBrouillons` : la cible garde son id et reçoit la somme, les
  // pièces et les notes des absorbés ; les absorbés passent en `fusionne`
  // (jamais supprimés, gardent leur ligne bancaire → le scan ne les recrée
  // pas). Purement local, aucun envoi Comptaweb (ADR-037).
  server.tool(
    'fusionner_brouillons',
    [
      "Fusionne plusieurs brouillons (draft) en UNE écriture — typiquement une famille qui paie une même chose en plusieurs virements.",
      "La cible garde son id, ses justificatifs et sa ligne bancaire ; son montant devient la SOMME de tous les brouillons.",
      "Les brouillons absorbés passent au statut 'fusionne' (fusionne_dans_id = la cible) : ils sortent du journal et des brouillons à traiter,",
      "la sync ne les recrée pas, et leurs justificatifs / dépôts / remboursements / notes sont reportés sur la cible.",
      "La cible reste reliée à toutes les lignes bancaires d'origine (champ lignes_bancaires de la réponse) pour le rapprochement dans Comptaweb.",
      "Intitulé et imputation : ceux de la cible par défaut, ou ceux passés ici. `ventilations` découpe l'écriture fusionnée (somme = total).",
      "Refusé pour toute écriture qui n'est pas un brouillon (déjà envoyée à Comptaweb ou miroir). Opération PUREMENT LOCALE, aucun envoi vers Comptaweb.",
      "Pour retrouver une fusion : list_ecritures(status='fusionne').",
    ].join(' '),
    {
      cible_id: z.string().describe("ID du brouillon conservé (ex: ECR-2026-123)."),
      absorbes_ids: z
        .array(z.string())
        .min(1)
        .describe('IDs des brouillons à absorber dans la cible.'),
      description: z.string().optional().describe("Intitulé de l'écriture fusionnée (par défaut celui de la cible)."),
      category_id: z.string().nullish().describe('Nature / catégorie (cf. list_categories). Par défaut celle de la cible.'),
      unite_id: z.string().nullish().describe('Unité (cf. list_unites). Par défaut celle de la cible.'),
      activite_id: z.string().nullish().describe('Activité (cf. list_activites). Par défaut celle de la cible.'),
      ventilations: z
        .array(
          z.object({
            montant: z.string().describe('Montant au format français, ex: "150,00".'),
            category_id: z.string().nullish(),
            unite_id: z.string().nullish(),
            activite_id: z.string().nullish(),
          }),
        )
        .min(1)
        .optional()
        .describe("Découpage optionnel de l'écriture fusionnée ; la somme doit égaler le total fusionné."),
    },
    async ({ cible_id, absorbes_ids, description, category_id, unite_id, activite_id, ventilations }) => {
      const result = await fusionnerBrouillons(ecritureCtx, {
        cibleId: cible_id,
        absorbesIds: absorbes_ids,
        description,
        category_id,
        unite_id,
        activite_id,
        ventilations: ventilations?.map((v) => ({
          amount_cents: parseAmount(v.montant),
          category_id: v.category_id ?? null,
          unite_id: v.unite_id ?? null,
          activite_id: v.activite_id ?? null,
        })),
      });
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: result.message }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
