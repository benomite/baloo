import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listCartes, createCarte, updateCarte } from '@/lib/services/cartes';

export function registerCarteTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_cartes',
    "Liste les cartes (CB classique + procurement) du groupe. Utilisé pour afficher dans les formulaires Baloo et pour l'inférence depuis l'intitulé bancaire.",
    { statut: z.enum(['active', 'ancienne']).optional() },
    async ({ statut }) => {
      const rows = await listCartes({ groupId: ctx.groupId }, { statut });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_carte',
    "Ajoute une carte (CB ou procurement). Le code_externe est facultatif et sert à l'inférence auto depuis l'intitulé bancaire (ex: 'P168XLW4O' pour une carte procurement).",
    {
      type: z.enum(['cb', 'procurement']),
      porteur: z.string().min(1),
      comptaweb_id: z.number().optional().describe('ID Comptaweb de la carte (visible via cw_referentiels_creer_ecriture)'),
      code_externe: z.string().optional().describe("Code figurant dans l'intitulé bancaire (procurement seulement en général)"),
    },
    async (args) => {
      const created = await createCarte(
        { groupId: ctx.groupId },
        {
          type: args.type,
          porteur: args.porteur,
          comptaweb_id: args.comptaweb_id ?? null,
          code_externe: args.code_externe ?? null,
        },
      );
      return { content: [{ type: 'text' as const, text: `Carte ${created.id} créée (${created.type}, ${created.porteur}).` }] };
    },
  );

  server.tool(
    'update_carte',
    'Met à jour une carte (statut, code_externe, comptaweb_id, porteur).',
    {
      id: z.string(),
      porteur: z.string().optional(),
      comptaweb_id: z.number().nullable().optional(),
      code_externe: z.string().nullable().optional(),
      statut: z.enum(['active', 'ancienne']).optional(),
    },
    async ({ id, ...patch }) => {
      const updated = await updateCarte({ groupId: ctx.groupId }, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Carte ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Carte ${updated.id} mise à jour.` }] };
    },
  );
}
