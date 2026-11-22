import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listMouvementsCaisse,
  createMouvementCaisse,
  updateMouvementCaisse,
  attachJustificatifMouvementCaisse,
} from '@/lib/services/caisse';
import {
  syncCaisseFromComptaweb,
  discoverCaisses,
  resolveCaisseId,
} from '@/lib/services/caisse-sync';
import { formatAmount, parseAmount } from '@/lib/format';
import { resolveScopedUnite } from '@/lib/scope';
import {
  ETATS_MOUVEMENT_CAISSE,
  ETATS_MOUVEMENT_CAISSE_PENDING,
  MOUVEMENT_CAISSE_TYPES,
  type EtatMouvementCaisse,
} from '@/lib/types';

const ETAT_ENUM = z.enum(ETATS_MOUVEMENT_CAISSE);

function texte(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function erreur(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, ...texte({ ok: false, error: msg }) };
}

export function registerCaisseTools(server: McpServer, ctx: McpContext) {
  const caisseCtx = { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds ?? null };

  // ─── list_mouvements_caisse ───────────────────────────────────────────
  //
  // Mêmes filtres que list_ecritures (#62) — `status` porte ici l'état du
  // mouvement vis-à-vis de Comptaweb (mirror / draft / pending / divergent),
  // `type` le type de mouvement caisse ; mode de paiement et carte n'ont pas
  // de sens pour des espèces. Avant de lister, on lance la sync caisse
  // existante (pull CW, sans écriture côté CW) : elle rafraîchit les miroirs
  // et donne le solde Comptaweb, affiché à côté du solde Baloo. Si
  // Comptaweb ne répond pas, la liste sort quand même, avec un solde CW
  // null et la raison — jamais un solde inventé.
  server.tool(
    'list_mouvements_caisse',
    [
      'Liste les mouvements de caisse (espèces), filtrables comme list_ecritures : période (date_debut, date_fin,',
      'month), catégorie, unité, activité, type, état, ID Comptaweb, recherche libre, pagination (limit, offset).',
      'Chaque mouvement porte `etat` : mirror (présent dans Comptaweb), draft (saisie Baloo en préparation),',
      'pending (déposé / rapproché, attend de remonter de Comptaweb) ou divergent. `status` filtre sur cet état',
      '(valeur ou liste) ; `pending_only` = draft + pending. Le résultat donne le solde de caisse Baloo',
      '(`solde_baloo`) à côté du solde Comptaweb (`solde_comptaweb`), après une sync caisse depuis Comptaweb.',
    ].join(' '),
    {
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      category_id: z.string().optional(),
      unite_id: z.string().optional(),
      activite_id: z.string().optional(),
      type: z.enum(MOUVEMENT_CAISSE_TYPES).optional(),
      status: z
        .union([ETAT_ENUM, z.array(ETAT_ENUM).min(1)])
        .optional()
        .describe('Filtre par état (valeur ou liste). Ex: ["draft","pending"]'),
      comptaweb_ecriture_id: z.number().int().optional(),
      pending_only: z
        .boolean()
        .optional()
        .describe('Si true : ne renvoie que les mouvements pas encore dans Comptaweb (draft / pending).'),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).optional(),
    },
    async (params) => {
      const { status, pending_only, ...rest } = params;
      let etats: EtatMouvementCaisse[] | undefined;
      if (Array.isArray(status)) etats = status;
      else if (status) etats = [status];
      if (pending_only) etats = ETATS_MOUVEMENT_CAISSE_PENDING;

      let soldeComptaweb: string | null = null;
      let soldeComptawebErreur: string | null = null;
      try {
        const sync = await syncCaisseFromComptaweb(ctx.groupId, await resolveCaisseId());
        soldeComptaweb = formatAmount(sync.soldeComptaweb);
      } catch (err) {
        soldeComptawebErreur = `Comptaweb injoignable : ${err instanceof Error ? err.message : String(err)}`;
      }

      const data = await listMouvementsCaisse(caisseCtx, { ...rest, etats });
      const result = {
        solde_baloo: formatAmount(data.solde),
        solde_comptaweb: soldeComptaweb,
        ...(soldeComptawebErreur ? { solde_comptaweb_erreur: soldeComptawebErreur } : {}),
        solde_caisse: formatAmount(data.solde),
        total: data.total,
        mouvements: data.mouvements.map((m) => ({
          ...m,
          montant: formatAmount(m.amount_cents),
          solde_apres:
            m.solde_apres_cents != null ? formatAmount(m.solde_apres_cents) : null,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── update_mouvement_caisse ──────────────────────────────────────────
  //
  // Enrichissement d'un mouvement existant, comme update_ecriture pour les
  // écritures bancaires. Différence voulue (#62) : sur un mouvement miroir,
  // un changement d'un champ tenu par Comptaweb est REFUSÉ en nommant le
  // champ (pas ignoré en silence), et rien n'est écrit. Aucun envoi vers
  // Comptaweb.
  server.tool(
    'update_mouvement_caisse',
    [
      'Modifie un mouvement de caisse EXISTANT : titre (description), catégorie (category_id, cf. list_categories),',
      'unité, activité, notes. Mise à jour locale Baloo, AUCUN envoi vers Comptaweb.',
      "Sur un mouvement miroir (etat 'mirror', présent dans Comptaweb), le titre, la catégorie, l'unité et",
      "l'activité sont tenus par Comptaweb : les changer est refusé (le message nomme le champ) et rien n'est",
      'modifié ; seules les notes restent modifiables. Pour corriger un miroir, modifie-le dans Comptaweb.',
      'Pour joindre une pièce, utilise attach_justificatif_mouvement_caisse.',
    ].join(' '),
    {
      id: z.string().describe('ID du mouvement de caisse (ex: CAI-2026-012)'),
      description: z.string().min(1).optional().describe('Titre du mouvement'),
      category_id: z.string().nullable().optional().describe('Nature / catégorie (cf. list_categories).'),
      unite_id: z.string().nullable().optional(),
      activite_id: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      try {
        const updated = await updateMouvementCaisse(caisseCtx, id, patch);
        if (!updated) return erreur(`Mouvement de caisse ${id} introuvable.`);
        return texte({ ok: true, mouvement: updated });
      } catch (err) {
        return erreur(err);
      }
    },
  );

  // ─── attach_justificatif_mouvement_caisse ─────────────────────────────
  //
  // Pièce justificative d'un mouvement de caisse : même table et même
  // stockage que les pièces des écritures (entity_type 'mouvement_caisse'),
  // fichier passé en base64 (pas de multipart en MCP HTTP). Permis sur un
  // miroir : la pièce est une donnée Baloo-only.
  server.tool(
    'attach_justificatif_mouvement_caisse',
    [
      'Joint une pièce justificative (ticket, facture…) à un mouvement de caisse, comme pour une écriture bancaire.',
      'Fichier en base64 (content_base64) avec son nom (filename, extension autorisée : pdf, jpg, png…).',
      "Le fichier transite par la requête MCP : au-delà d'environ 4 Mo, la plateforme le refuse — dépose-le alors via l'app.",
      'Possible aussi sur un mouvement miroir. Les pièces jointes se relisent via',
      "list_justificatifs(entity_type='mouvement_caisse', entity_id=<id>).",
    ].join(' '),
    {
      mouvement_id: z.string().describe('ID du mouvement de caisse'),
      filename: z.string().min(1).describe('Nom du fichier, avec extension (ex: ticket.pdf)'),
      content_base64: z.string().min(1).describe('Contenu du fichier encodé en base64'),
      mime_type: z.string().optional(),
    },
    async (params) => {
      try {
        const justificatif = await attachJustificatifMouvementCaisse(caisseCtx, params.mouvement_id, {
          filename: params.filename,
          content: Buffer.from(params.content_base64, 'base64'),
          mime_type: params.mime_type ?? null,
        });
        return texte({ ok: true, justificatif });
      } catch (err) {
        return erreur(err);
      }
    },
  );

  server.tool(
    'cw_list_caisses',
    'Liste les caisses du groupe côté Comptaweb (utile pour récupérer caisseId à passer à cw_sync_caisse).',
    {},
    async () => {
      const caisses = await discoverCaisses();
      return { content: [{ type: 'text' as const, text: JSON.stringify({ caisses }, null, 2) }] };
    },
  );

  server.tool(
    'cw_sync_caisse',
    "Synchronise les mouvements de caisse depuis Comptaweb vers Baloo (pull). sync_run le fait déjà à chaque cycle : cet outil sert à cibler une autre caisse (caisse_id). Idempotent : ne crée pas de doublon (matching par comptaweb_ecriture_id, fallback numero_piece+date+montant). Si caisse_id est omis, prend la première caisse active.",
    {
      caisse_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('ID de la caisse Comptaweb (cf. cw_list_caisses).'),
    },
    async (params) => {
      const caisseId = params.caisse_id ?? (await resolveCaisseId());
      const data = await syncCaisseFromComptaweb(ctx.groupId, caisseId);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...data,
                solde_comptaweb: formatAmount(data.soldeComptaweb),
                solde_baloo: formatAmount(data.soldeBaloo),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // create_mouvement_caisse crée un BROUILLON destiné à Comptaweb (#61),
  // comme un brouillon bancaire : il part dans la caisse CW via
  // push_mouvement_caisse_comptaweb, puis sync_run le reconnaît comme la
  // ligne CW (cf. services/caisse-comptaweb).
  server.tool(
    'create_mouvement_caisse',
    "Crée un brouillon de mouvement de caisse (entrée ou sortie d'espèces) destiné à Comptaweb, statut 'draft'. Comme un brouillon bancaire, il doit porter nature (category_id), unité et activité pour être envoyé : compléter via update_mouvement_caisse, prévisualiser puis envoyer via push_mouvement_caisse_comptaweb. Le sync_run suivant le reconnaît comme la ligne de caisse Comptaweb.",
    {
      date_mouvement: z.string().describe('Date du mouvement (YYYY-MM-DD)'),
      description: z.string().describe('Description'),
      montant: z.string().describe('Montant signé : "+15,00" pour entrée, "-8,50" pour sortie'),
      category_id: z.string().optional().describe('Nature (cf. list_categories)'),
      unite_id: z.string().optional().describe('Unité (cf. list_unites)'),
      activite_id: z.string().optional().describe('Activité (cf. list_activites)'),
      notes: z.string().optional(),
    },
    async (params) => {
      // Même règle que les écritures : un chef d'unité ne crée que pour les
      // siennes (unique unité imposée, sinon choix parmi les siennes).
      let uniteId: string | null;
      try {
        uniteId = resolveScopedUnite(ctx.scopeUniteIds ?? [], params.unite_id ?? null);
      } catch (err) {
        return erreur(err);
      }
      const created = await createMouvementCaisse(caisseCtx, {
        date_mouvement: params.date_mouvement,
        description: params.description,
        amount_cents: parseAmount(params.montant),
        status: 'draft',
        category_id: params.category_id ?? null,
        unite_id: uniteId,
        activite_id: params.activite_id ?? null,
        notes: params.notes ?? null,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...created,
                montant: formatAmount(created.amount_cents),
                solde_apres:
                  created.solde_apres_cents != null
                    ? formatAmount(created.solde_apres_cents)
                    : null,
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
