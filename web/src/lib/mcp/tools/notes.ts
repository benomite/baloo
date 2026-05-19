import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listNotes, createNote, updateNote, deleteNote } from '@/lib/services/notes';

export function registerNoteTools(server: McpServer, ctx: McpContext) {
  const noteCtx = { groupId: ctx.groupId, userId: ctx.userId };

  server.tool(
    'list_notes',
    'Liste les notes libres du groupe (mémoire LLM structurée : asso, finances, comptes, outils, incidents...).',
    {
      topic: z.string().optional().describe("Filtre par thème (ex: 'comptes', 'asso', 'finances')"),
      user_only: z.boolean().optional().describe('Si vrai, ne renvoie que les notes appartenant au user courant'),
    },
    async (params) => {
      const rows = await listNotes(noteCtx, {
        topic: params.topic,
        user_only: params.user_only,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
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
      const created = await createNote(noteCtx, {
        topic: params.topic,
        title: params.title ?? null,
        content_md: params.content_md,
        shared: params.shared,
      });
      return { content: [{ type: 'text' as const, text: `Note ${created.id} créée (topic=${params.topic}).` }] };
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
      const updated = await updateNote(noteCtx, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Note ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Note ${id} mise à jour.` }] };
    },
  );

  // SEULE opération destructive exposée par MCP. Conservée car la doctrine
  // "JAMAIS DELETE" vise les écritures, justifs, rembs — les notes
  // tolèrent la suppression. Description explicite : "utiliser avec
  // parcimonie".
  server.tool(
    'delete_note',
    'Supprime une note. Utiliser avec parcimonie — préférer update_note pour marquer une info obsolète.',
    { id: z.string() },
    async ({ id }) => {
      const deleted = await deleteNote(noteCtx, id);
      if (!deleted) {
        return { content: [{ type: 'text' as const, text: `Note ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Note ${id} supprimée.` }] };
    },
  );
}
