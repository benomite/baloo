import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

const TYPES = ['cb', 'procurement'] as const;
const STATUTS = ['active', 'ancienne'] as const;

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextCarteId(groupId: string, type: string, porteur: string): string {
  const base = `carte-${type === 'procurement' ? 'proc' : 'cb'}-${slugify(porteur)}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM cartes WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

export function registerCarteTools(server: McpServer) {
  server.tool(
    'list_cartes',
    "Liste les cartes (CB classique + procurement) du groupe. Utilisé pour afficher dans les formulaires Baloo et pour l'inférence depuis l'intitulé bancaire.",
    { statut: z.enum(STATUTS).optional() },
    ({ statut }) => {
      const { groupId } = getCurrentContext();
      let sql = 'SELECT id, type, porteur, comptaweb_id, code_externe, statut FROM cartes WHERE group_id = ?';
      const params: (string | number)[] = [groupId];
      if (statut) { sql += ' AND statut = ?'; params.push(statut); }
      else { sql += " AND statut = 'active'"; }
      sql += ' ORDER BY type, porteur';
      const rows = getDb().prepare(sql).all(...params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_carte',
    "Ajoute une carte (CB ou procurement). Le code_externe est facultatif et sert à l'inférence auto depuis l'intitulé bancaire (ex: 'P168XLW4O' pour une carte procurement).",
    {
      type: z.enum(TYPES),
      porteur: z.string().min(1),
      comptaweb_id: z.number().optional().describe("ID Comptaweb de la carte (visible via cw_referentiels_creer_ecriture)"),
      code_externe: z.string().optional().describe("Code figurant dans l'intitulé bancaire (procurement seulement en général)"),
    },
    ({ type, porteur, comptaweb_id, code_externe }) => {
      const ctx = getCurrentContext();
      const id = nextCarteId(ctx.groupId, type, porteur);
      const now = currentTimestamp();
      getDb().prepare(
        `INSERT INTO cartes (id, group_id, type, porteur, comptaweb_id, code_externe, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, ctx.groupId, type, porteur, comptaweb_id ?? null, code_externe ?? null, now, now);
      return { content: [{ type: 'text', text: `Carte ${id} créée (${type}, ${porteur}).` }] };
    },
  );

  server.tool(
    'update_carte',
    "Met à jour une carte (statut, code_externe, comptaweb_id, porteur).",
    {
      id: z.string(),
      porteur: z.string().optional(),
      comptaweb_id: z.number().nullable().optional(),
      code_externe: z.string().nullable().optional(),
      statut: z.enum(STATUTS).optional(),
    },
    (args) => {
      const { id, ...rest } = args;
      const fields: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue;
        fields.push(`${k} = ?`);
        values.push(v as string | number | null);
      }
      if (fields.length === 0) {
        return { content: [{ type: 'text', text: 'Rien à mettre à jour.' }], isError: true };
      }
      fields.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(id);
      const info = getDb().prepare(`UPDATE cartes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucune carte ${id} trouvée.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Carte ${id} mise à jour.` }] };
    },
  );
}
