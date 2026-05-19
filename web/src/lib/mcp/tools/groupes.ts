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
    'Met à jour les informations du groupe courant (nom, territoire, adresse, email, IBAN principal).',
    {
      nom: z.string().optional(),
      territoire: z.string().nullable().optional(),
      adresse: z.string().nullable().optional(),
      email_contact: z.string().nullable().optional(),
      iban_principal: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const updated = await updateGroupe({ groupId: ctx.groupId }, params);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Groupe ${ctx.groupId} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Groupe ${updated.id} mis à jour.` }] };
    },
  );
}
