import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function nextNoteId(groupId: string, topic: string, title: string | null): string {
  const base = `note-${slugify(topic)}-${slugify(title ?? 'sans-titre')}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notes WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

export function registerNoteTools(server: McpServer) {
  server.tool(
    'list_notes',
    "Liste les notes libres du groupe (mémoire LLM structurée : asso, finances, comptes, outils, incidents...).",
    {
      topic: z.string().optional().describe("Filtre par thème (ex: 'comptes', 'asso', 'finances')"),
      user_only: z.boolean().optional().describe("Si vrai, ne renvoie que les notes appartenant au user courant"),
    },
    ({ topic, user_only }) => {
      const ctx = getCurrentContext();
      let sql = 'SELECT id, topic, title, content_md, user_id, created_at, updated_at FROM notes WHERE group_id = ?';
      const params: (string | number | null)[] = [ctx.groupId];
      if (topic) { sql += ' AND topic = ?'; params.push(topic); }
      if (user_only) { sql += ' AND user_id = ?'; params.push(ctx.userId); }
      sql += ' ORDER BY topic, title, updated_at DESC';
      const rows = getDb().prepare(sql).all(...params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    'create_note',
    "Crée une note libre (markdown). Utile pour consigner du contexte, des décisions, des incidents.",
    {
      topic: z.string().describe("Thème (ex: 'asso', 'finances', 'comptes', 'outils', 'incidents')"),
      title: z.string().optional(),
      content_md: z.string().min(1),
      shared: z.boolean().optional().describe("Si vrai, note partagée au groupe ; sinon, note personnelle du user courant"),
    },
    ({ topic, title, content_md, shared }) => {
      const ctx = getCurrentContext();
      const id = nextNoteId(ctx.groupId, topic, title ?? null);
      const now = currentTimestamp();
      getDb().prepare(
        `INSERT INTO notes (id, group_id, user_id, topic, title, content_md, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, ctx.groupId, shared ? null : ctx.userId, topic, title ?? null, content_md, now, now);
      return { content: [{ type: 'text', text: `Note ${id} créée (topic=${topic}).` }] };
    }
  );

  server.tool(
    'update_note',
    "Met à jour une note existante (titre, contenu, topic).",
    {
      id: z.string(),
      topic: z.string().optional(),
      title: z.string().nullable().optional(),
      content_md: z.string().optional(),
    },
    ({ id, topic, title, content_md }) => {
      const fields: string[] = [];
      const values: (string | null)[] = [];
      if (topic !== undefined) { fields.push('topic = ?'); values.push(topic); }
      if (title !== undefined) { fields.push('title = ?'); values.push(title); }
      if (content_md !== undefined) { fields.push('content_md = ?'); values.push(content_md); }
      if (fields.length === 0) {
        return { content: [{ type: 'text', text: 'Rien à mettre à jour.' }], isError: true };
      }
      fields.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(id);
      const info = getDb().prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucune note trouvée avec l'id ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Note ${id} mise à jour.` }] };
    }
  );

  server.tool(
    'delete_note',
    "Supprime une note. Utiliser avec parcimonie — préférer update_note pour marquer une info obsolète.",
    { id: z.string() },
    ({ id }) => {
      const info = getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucune note trouvée avec l'id ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Note ${id} supprimée.` }] };
    }
  );
}
