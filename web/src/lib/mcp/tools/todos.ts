import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listTodos,
  createTodo,
  completeTodo,
  updateTodo,
  TODO_STATUSES,
} from '@/lib/services/todos';

const STATUS_ENUM = z.enum(TODO_STATUSES);

export function registerTodoTools(server: McpServer, ctx: McpContext) {
  const todoCtx = { groupId: ctx.groupId, userId: ctx.userId };

  server.tool(
    'list_todos',
    'Liste les tâches du trésorier, avec filtre optionnel par statut (par défaut : en_cours + bientot + recurrent).',
    {
      status: STATUS_ENUM.optional().describe("Filtre par statut. Si omis, renvoie tout sauf 'fait' et 'annule'."),
      include_fait: z.boolean().optional().describe('Inclure les tâches faites (par défaut non).'),
    },
    async (params) => {
      const rows = await listTodos(todoCtx, {
        status: params.status,
        include_fait: params.include_fait,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_todo',
    "Crée une nouvelle tâche. Utilise status='recurrent' pour les tâches à vérifier régulièrement.",
    {
      title: z.string().min(1).describe('Titre court de la tâche'),
      description: z.string().optional().describe('Détails / contexte'),
      status: STATUS_ENUM.optional().describe('Statut initial (défaut : en_cours)'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date d'échéance ISO (YYYY-MM-DD)"),
    },
    async (params) => {
      const created = await createTodo(todoCtx, params);
      return { content: [{ type: 'text' as const, text: `Tâche ${created.id} créée : "${params.title}".` }] };
    },
  );

  server.tool(
    'complete_todo',
    'Marque une tâche comme faite.',
    { id: z.string().describe('ID de la tâche (ex: TODO-2026-001)') },
    async ({ id }) => {
      const updated = await completeTodo(todoCtx, id);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Tâche ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Tâche ${id} cochée.` }] };
    },
  );

  server.tool(
    'update_todo',
    'Met à jour une tâche existante (titre, description, statut, échéance).',
    {
      id: z.string().describe('ID de la tâche'),
      title: z.string().optional(),
      description: z.string().optional(),
      status: STATUS_ENUM.optional(),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional()
        .describe("Nouvelle date d'échéance, ou null pour retirer"),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await updateTodo(todoCtx, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Tâche ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Tâche ${id} mise à jour.` }] };
    },
  );
}
