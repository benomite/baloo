import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { getGroupe, updateGroupe } from '@/lib/services/groupes';

export function registerGroupeTools(server: McpServer, ctx: McpContext) {
  server.tool('get_groupe', 'Renvoie les informations du groupe courant.', {}, async () => {
    const row = await getGroupe({ groupId: ctx.groupId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(row, null, 2) }] };
  });

  server.tool(
    'update_groupe',
    'Met à jour les informations du groupe courant (nom, territoire, adresse, email, IBAN principal, taux kilométrique).',
    {
      nom: z.string().optional(),
      territoire: z.string().nullable().optional(),
      adresse: z.string().nullable().optional(),
      email_contact: z.string().nullable().optional(),
      iban_principal: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      taux_km: z
        .number()
        .positive()
        .optional()
        .describe(
          "Taux kilométrique en euros par km (ex: 0.354). Converti en millièmes d'euro en interne (même conversion que /admin/parametres).",
        ),
    },
    async (params) => {
      const { taux_km, ...rest } = params;
      const patch: Parameters<typeof updateGroupe>[1] = { ...rest };
      if (taux_km !== undefined) {
        patch.taux_km_millicents = Math.round(taux_km * 1000);
      }
      const updated = await updateGroupe({ groupId: ctx.groupId }, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Groupe ${ctx.groupId} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Groupe ${updated.id} mis à jour.` }] };
    },
  );
}
