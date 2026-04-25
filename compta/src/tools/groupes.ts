import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

interface GroupeRow {
  id: string;
  [key: string]: unknown;
}

export function registerGroupeTools(server: McpServer) {
  server.tool('get_groupe', 'Renvoie les informations du groupe courant.', {}, async () => {
    const row = await api.get<GroupeRow>('/api/groupe');
    return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
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
      const updated = await api.patch<GroupeRow>('/api/groupe', params);
      return { content: [{ type: 'text', text: `Groupe ${updated.id} mis à jour.` }] };
    },
  );
}
