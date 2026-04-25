import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

const STATUSES = ['en_cours', 'bientot', 'fait', 'annule', 'recurrent'] as const;

interface TodoRow {
  id: string;
  [key: string]: unknown;
}

export function registerTodoTools(server: McpServer) {
  server.tool(
    'list_todos',
    'Liste les tâches du trésorier, avec filtre optionnel par statut (par défaut : en_cours + bientot + recurrent).',
    {
      status: z.enum(STATUSES).optional().describe("Filtre par statut. Si omis, renvoie tout sauf 'fait' et 'annule'."),
      include_fait: z.boolean().optional().describe('Inclure les tâches faites (par défaut non).'),
    },
    async (params) => {
      const rows = await api.get<TodoRow[]>('/api/todos', params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_todo',
    "Crée une nouvelle tâche. Utilise status='recurrent' pour les tâches à vérifier régulièrement.",
    {
      title: z.string().min(1).describe('Titre court de la tâche'),
      description: z.string().optional().describe('Détails / contexte'),
      status: z.enum(STATUSES).optional().describe('Statut initial (défaut : en_cours)'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date d'échéance ISO (YYYY-MM-DD)"),
    },
    async (params) => {
      const created = await api.post<TodoRow>('/api/todos', params);
      return { content: [{ type: 'text', text: `Tâche ${created.id} créée : "${params.title}".` }] };
    },
  );

  server.tool(
    'complete_todo',
    'Marque une tâche comme faite.',
    { id: z.string().describe('ID de la tâche (ex: TODO-2026-001)') },
    async (params) => {
      await api.post(`/api/todos/${encodeURIComponent(params.id)}/complete`);
      return { content: [{ type: 'text', text: `Tâche ${params.id} cochée.` }] };
    },
  );

  server.tool(
    'update_todo',
    'Met à jour une tâche existante (titre, description, statut, échéance).',
    {
      id: z.string().describe('ID de la tâche'),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional()
        .describe("Nouvelle date d'échéance, ou null pour retirer"),
    },
    async (params) => {
      const { id, ...patch } = params;
      await api.patch(`/api/todos/${encodeURIComponent(id)}`, patch);
      return { content: [{ type: 'text', text: `Tâche ${id} mise à jour.` }] };
    },
  );
}
