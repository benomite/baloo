import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listCamps,
  createCamp,
  updateCampStatut,
  CAMP_STATUTS,
} from '@/lib/services/camps';
import {
  listAvancesForCamp,
  createAvance,
  cloturerAvance,
  rouvrirAvance,
  AVANCE_MODES,
} from '@/lib/services/camp-avances';
import { formatAmount, parseAmount } from '@/lib/format';

export function registerCampsTools(server: McpServer, ctx: McpContext) {
  const campCtx = { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds ?? null };

  server.tool(
    'list_camps',
    'Liste les camps du groupe (avec unité et activité Comptaweb associées).',
    {
      statut: z.enum(CAMP_STATUTS).optional().describe("Filtre par statut : 'preparation', 'en_cours' ou 'cloture'."),
    },
    async ({ statut }) => {
      const rows = await listCamps(campCtx);
      const filtered = statut ? rows.filter((c) => c.statut === statut) : rows;
      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
    },
  );

  server.tool(
    'create_camp',
    'Crée un nouveau camp (séjour) lié à une unité et une activité Comptaweb.',
    {
      name: z.string().min(1).describe('Nom du camp (ex: "Camp été Castors 2026").'),
      unite_id: z.string().describe("ID de l'unité concernée (cf. list_unites)."),
      activite_id: z.string().describe("ID de l'activité Comptaweb (cf. list_activites)."),
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date de début (YYYY-MM-DD).'),
      date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date de fin (YYYY-MM-DD).'),
      notes: z.string().optional(),
    },
    async (params) => {
      const camp = await createCamp(
        { groupId: ctx.groupId },
        {
          name: params.name,
          unite_id: params.unite_id,
          activite_id: params.activite_id,
          date_debut: params.date_debut ?? null,
          date_fin: params.date_fin ?? null,
          notes: params.notes ?? null,
        },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(camp, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'update_camp',
    "Met à jour le statut d'un camp ('preparation' → 'en_cours' → 'cloture').",
    {
      id: z.string().describe("ID du camp (ex: 'CAMP-2026-001')."),
      statut: z.enum(CAMP_STATUTS).describe("Nouveau statut du camp."),
    },
    async ({ id, statut }) => {
      const res = await updateCampStatut(campCtx, id, statut);
      if (!res.ok) {
        return { content: [{ type: 'text' as const, text: `Erreur : ${res.error}` }] };
      }
      return { content: [{ type: 'text' as const, text: `Camp ${id} mis à jour → statut '${statut}'.` }] };
    },
  );

  server.tool(
    'list_avances_camp',
    "Liste les avances de trésorerie versées pour un camp, avec résumé (total versé, en circulation, consommé).",
    {
      camp_id: z.string().describe("ID du camp."),
    },
    async ({ camp_id }) => {
      const data = await listAvancesForCamp(campCtx, camp_id);
      if (!data) {
        return { content: [{ type: 'text' as const, text: 'Camp introuvable.' }] };
      }
      const result = {
        avances: data.avances.map((a) => ({
          ...a,
          montant: formatAmount(a.montant_cents),
          montant_rendu: a.montant_rendu_cents != null ? formatAmount(a.montant_rendu_cents) : null,
        })),
        summary: {
          totalVerse: formatAmount(data.summary.totalVerseCents),
          enCirculation: formatAmount(data.summary.enCirculationCents),
          totalRendu: formatAmount(data.summary.totalRenduCents),
          consomme: formatAmount(data.summary.consommeCents),
          enCoursCount: data.summary.enCoursCount,
        },
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_avance_camp',
    "Enregistre une avance de trésorerie versée à un chef pour un camp. L'avance est un transfert (pas une dépense du camp) — les tickets de dépenses sont traités séparément.",
    {
      camp_id: z.string().describe("ID du camp concerné."),
      beneficiaire: z.string().min(1).describe('Nom du bénéficiaire (chef ou responsable).'),
      montant: z.string().describe("Montant de l'avance en format français, ex: '150,00' ou '1 200'."),
      mode: z.enum(AVANCE_MODES).describe("Mode de versement : 'virement' ou 'especes'."),
      date_versement: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date de versement (YYYY-MM-DD).'),
      ecriture_id: z.string().optional().describe("ID de l'écriture du virement (traçabilité, optionnel)."),
      notes: z.string().optional(),
    },
    async (params) => {
      const montant_cents = parseAmount(params.montant);
      const res = await createAvance(
        campCtx,
        {
          camp_id: params.camp_id,
          beneficiaire: params.beneficiaire,
          montant_cents,
          mode: params.mode,
          date_versement: params.date_versement ?? null,
          ecriture_id: params.ecriture_id ?? null,
          notes: params.notes ?? null,
        },
      );
      if (!res.ok) {
        return { content: [{ type: 'text' as const, text: `Erreur : ${res.error}` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Avance de ${formatAmount(montant_cents)} créée pour ${params.beneficiaire} (camp ${params.camp_id}).`,
          },
        ],
      };
    },
  );

  server.tool(
    'cloturer_avance_camp',
    "Clôture une avance de trésorerie en enregistrant le montant rendu par le bénéficiaire. La différence (avance − rendu) représente les dépenses consommées.",
    {
      id: z.string().describe("ID de l'avance à clôturer."),
      montant_rendu: z.string().describe("Montant rendu par le bénéficiaire en format français, ex: '42,50'. Mettre '0' ou '0,00' si rien n'est rendu."),
    },
    async ({ id, montant_rendu }) => {
      const rendu_cents = parseAmount(montant_rendu === '' ? '0' : montant_rendu);
      const res = await cloturerAvance(campCtx, id, rendu_cents);
      if (!res.ok) {
        return { content: [{ type: 'text' as const, text: `Erreur : ${res.error}` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Avance ${id} clôturée. Rendu : ${formatAmount(rendu_cents)}.`,
          },
        ],
      };
    },
  );

  server.tool(
    'rouvrir_avance_camp',
    "Rouvre une avance de trésorerie clôturée par erreur (remet le statut à 'versee', efface le montant rendu).",
    {
      id: z.string().describe("ID de l'avance à rouvrir."),
    },
    async ({ id }) => {
      const res = await rouvrirAvance(campCtx, id);
      if (!res.ok) {
        return { content: [{ type: 'text' as const, text: `Erreur : ${res.error}` }] };
      }
      return { content: [{ type: 'text' as const, text: `Avance ${id} rouverte (statut 'versee').` }] };
    },
  );
}
