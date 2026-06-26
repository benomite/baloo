import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listRepartitions,
  createRepartition,
  updateRepartition,
  deleteRepartition,
  RepartitionValidationError,
} from '@/lib/services/repartitions';
import { formatAmount, parseAmount } from '@/lib/format';

export function registerRepartitionsTools(server: McpServer, ctx: McpContext) {
  const repCtx = { groupId: ctx.groupId };

  server.tool(
    'list_repartitions',
    "Liste les répartitions budgétaires entre unités (transferts de budget d'une unité vers une autre, ou du groupe vers une unité).",
    {
      saison: z.string().regex(/^\d{4}-\d{4}$/).optional().describe("Filtre par saison (ex: '2025-2026')."),
    },
    async ({ saison }) => {
      const rows = await listRepartitions(repCtx, { saison });
      const result = rows.map((r) => ({
        ...r,
        montant: formatAmount(r.montant_cents),
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_repartition',
    "Crée une répartition budgétaire : transfert d'un montant depuis une unité source (ou le groupe) vers une unité cible (ou le groupe). Source et cible ne peuvent pas être identiques.",
    {
      date_repartition: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date de la répartition (YYYY-MM-DD).'),
      saison: z.string().regex(/^\d{4}-\d{4}$/).describe("Saison budgétaire (ex: '2025-2026')."),
      montant: z.string().describe("Montant en format français, ex: '500,00' ou '1 200'."),
      unite_source_id: z.string().nullable().describe("ID de l'unité source, ou null pour le groupe."),
      unite_cible_id: z.string().nullable().describe("ID de l'unité cible, ou null pour le groupe."),
      libelle: z.string().min(1).describe("Libellé de la répartition (ex: 'Dotation camp été Castors')."),
      notes: z.string().optional(),
    },
    async (params) => {
      const montant_cents = parseAmount(params.montant);
      try {
        const created = await createRepartition(repCtx, {
          date_repartition: params.date_repartition,
          saison: params.saison,
          montant_cents,
          unite_source_id: params.unite_source_id,
          unite_cible_id: params.unite_cible_id,
          libelle: params.libelle,
          notes: params.notes ?? null,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ...created, montant: formatAmount(created.montant_cents) }, null, 2),
            },
          ],
        };
      } catch (e) {
        if (e instanceof RepartitionValidationError) {
          return { content: [{ type: 'text' as const, text: `Erreur de validation : ${e.message}` }] };
        }
        throw e;
      }
    },
  );

  server.tool(
    'update_repartition',
    "Modifie une répartition existante (date, saison, montant, libellé, notes). Pour changer la source ou la cible, supprimer et recréer.",
    {
      id: z.string().describe("ID de la répartition à modifier."),
      date_repartition: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      saison: z.string().regex(/^\d{4}-\d{4}$/).optional(),
      montant: z.string().optional().describe("Nouveau montant en format français, ex: '750,00'."),
      libelle: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const patch: Parameters<typeof updateRepartition>[2] = {};
      if (params.date_repartition !== undefined) patch.date_repartition = params.date_repartition;
      if (params.saison !== undefined) patch.saison = params.saison;
      if (params.montant !== undefined) patch.montant_cents = parseAmount(params.montant);
      if (params.libelle !== undefined) patch.libelle = params.libelle;
      if (params.notes !== undefined) patch.notes = params.notes;

      try {
        const updated = await updateRepartition(repCtx, params.id, patch);
        if (!updated) {
          return { content: [{ type: 'text' as const, text: `Répartition ${params.id} introuvable.` }] };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ...updated, montant: formatAmount(updated.montant_cents) }, null, 2),
            },
          ],
        };
      } catch (e) {
        if (e instanceof RepartitionValidationError) {
          return { content: [{ type: 'text' as const, text: `Erreur de validation : ${e.message}` }] };
        }
        throw e;
      }
    },
  );

  server.tool(
    'delete_repartition',
    "Supprime une répartition budgétaire. Les répartitions sont des données de planification (pas des écritures comptables) — la suppression est autorisée.",
    {
      id: z.string().describe("ID de la répartition à supprimer."),
    },
    async ({ id }) => {
      const deleted = await deleteRepartition(repCtx, id);
      if (!deleted) {
        return { content: [{ type: 'text' as const, text: `Répartition ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Répartition ${id} supprimée.` }] };
    },
  );
}
