import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

interface NoteRow {
  id: string;
  [key: string]: unknown;
}

export function registerNoteTools(server: McpServer) {
  server.tool(
    'list_notes',
    'Liste les notes libres du groupe (mémoire LLM structurée : asso, finances, comptes, outils, incidents...).',
    {
      topic: z.string().optional().describe("Filtre par thème (ex: 'comptes', 'asso', 'finances')"),
      user_only: z.boolean().optional().describe('Si vrai, ne renvoie que les notes appartenant au user courant'),
    },
    async (params) => {
      const rows = await api.get<NoteRow[]>('/api/notes', params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_note',
    'Crée une note libre (markdown). Utile pour consigner du contexte, des décisions, des incidents.',
    {
      topic: z.string().describe("Thème (ex: 'asso', 'finances', 'comptes', 'outils', 'incidents')"),
      title: z.string().optional(),
      content_md: z.string().min(1),
      shared: z.boolean().optional().describe('Si vrai, note partagée au groupe ; sinon, note personnelle du user courant'),
    },
    async (params) => {
      const created = await api.post<NoteRow>('/api/notes', params);
      return { content: [{ type: 'text', text: `Note ${created.id} créée (topic=${params.topic}).` }] };
    },
  );

  server.tool(
    'update_note',
    'Met à jour une note existante (titre, contenu, topic).',
    {
      id: z.string(),
      topic: z.string().optional(),
      title: z.string().nullable().optional(),
      content_md: z.string().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      await api.patch(`/api/notes/${encodeURIComponent(id)}`, patch);
      return { content: [{ type: 'text', text: `Note ${id} mise à jour.` }] };
    },
  );

  server.tool(
    'delete_note',
    'Supprime une note. Utiliser avec parcimonie — préférer update_note pour marquer une info obsolète.',
    { id: z.string() },
    async (params) => {
      await api.del(`/api/notes/${encodeURIComponent(params.id)}`);
      return { content: [{ type: 'text', text: `Note ${params.id} supprimée.` }] };
    },
  );
}
