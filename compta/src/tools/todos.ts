import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

const STATUSES = ['en_cours', 'bientot', 'fait', 'annule', 'recurrent'] as const;
type Status = (typeof STATUSES)[number];

interface TodoRow {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function nextTodoId(groupId: string): string {
  const year = new Date().getFullYear();
  const prefix = `TODO-${year}-`;
  const row = getDb()
    .prepare(
      `SELECT id FROM todos WHERE group_id = ? AND id LIKE ? ORDER BY id DESC LIMIT 1`
    )
    .get(groupId, `${prefix}%`) as { id: string } | undefined;
  const next = row ? parseInt(row.id.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export function registerTodoTools(server: McpServer) {
  server.tool(
    'list_todos',
    'Liste les tâches du trésorier, avec filtre optionnel par statut (par défaut : en_cours + bientot + recurrent).',
    {
      status: z.enum(STATUSES).optional().describe("Filtre par statut. Si omis, renvoie tout sauf 'fait' et 'annule'."),
      include_fait: z.boolean().optional().describe("Inclure les tâches faites (par défaut non)."),
    },
    ({ status, include_fait }) => {
      const { groupId } = getCurrentContext();
      let sql = 'SELECT * FROM todos WHERE group_id = ?';
      const params: (string | number)[] = [groupId];
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      } else if (!include_fait) {
        sql += " AND status NOT IN ('fait', 'annule')";
      }
      sql += ' ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at';
      const rows = getDb().prepare(sql).all(...params) as TodoRow[];
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    'create_todo',
    "Crée une nouvelle tâche. Utilise status='recurrent' pour les tâches à vérifier régulièrement.",
    {
      title: z.string().min(1).describe("Titre court de la tâche"),
      description: z.string().optional().describe("Détails / contexte"),
      status: z.enum(STATUSES).optional().describe("Statut initial (défaut : en_cours)"),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date d'échéance ISO (YYYY-MM-DD)"),
    },
    ({ title, description, status, due_date }) => {
      const ctx = getCurrentContext();
      const id = nextTodoId(ctx.groupId);
      const now = currentTimestamp();
      getDb().prepare(
        `INSERT INTO todos (id, group_id, user_id, title, description, status, due_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, ctx.groupId, ctx.userId, title, description ?? null, status ?? 'en_cours', due_date ?? null, now, now);
      return { content: [{ type: 'text', text: `Tâche ${id} créée : "${title}".` }] };
    }
  );

  server.tool(
    'complete_todo',
    "Marque une tâche comme faite.",
    { id: z.string().describe("ID de la tâche (ex: TODO-2026-001)") },
    ({ id }) => {
      const now = currentTimestamp();
      const info = getDb().prepare(
        `UPDATE todos SET status = 'fait', completed_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, now, id);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucune tâche trouvée avec l'id ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Tâche ${id} cochée.` }] };
    }
  );

  server.tool(
    'update_todo',
    "Met à jour une tâche existante (titre, description, statut, échéance).",
    {
      id: z.string().describe("ID de la tâche"),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("Nouvelle date d'échéance, ou null pour retirer"),
    },
    ({ id, title, description, status, due_date }) => {
      const fields: string[] = [];
      const values: (string | null)[] = [];
      if (title !== undefined) { fields.push('title = ?'); values.push(title); }
      if (description !== undefined) { fields.push('description = ?'); values.push(description); }
      if (status !== undefined) { fields.push('status = ?'); values.push(status); }
      if (due_date !== undefined) { fields.push('due_date = ?'); values.push(due_date); }
      if (fields.length === 0) {
        return { content: [{ type: 'text', text: 'Rien à mettre à jour.' }], isError: true };
      }
      fields.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(id);
      const info = getDb().prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucune tâche trouvée avec l'id ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Tâche ${id} mise à jour.` }] };
    }
  );
}
