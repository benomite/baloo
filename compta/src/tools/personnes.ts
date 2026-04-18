import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

const ROLES = [
  'tresorier',
  'cotresorier',
  'co-rg',
  'rg',
  'secretaire_principal',
  'secretaire_adjoint',
  'responsable_com',
  'responsable_matos',
  'chef_unite',
  'cheftaine_unite',
  'parent',
  'benevole',
  'autre',
] as const;

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextPersonneId(groupId: string, prenom: string, nom: string | null): string {
  const base = `per-${slugify(prenom)}${nom ? `-${slugify(nom)}` : ''}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM personnes WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

export function registerPersonneTools(server: McpServer) {
  server.tool(
    'list_personnes',
    "Liste l'annuaire du groupe (trésoriers, secrétaires, chefs, parents, bénévoles...). Filtres optionnels.",
    {
      statut: z.enum(['actif', 'ancien', 'inactif']).optional(),
      role: z.string().optional().describe("Filtre par role_groupe (ex: 'co-rg', 'chef_unite')"),
      unite_id: z.string().optional(),
    },
    ({ statut, role, unite_id }) => {
      const { groupId } = getCurrentContext();
      let sql = 'SELECT * FROM personnes WHERE group_id = ?';
      const params: (string | number)[] = [groupId];
      if (statut) { sql += ' AND statut = ?'; params.push(statut); }
      else { sql += " AND statut = 'actif'"; }
      if (role) { sql += ' AND role_groupe = ?'; params.push(role); }
      if (unite_id) { sql += ' AND unite_id = ?'; params.push(unite_id); }
      sql += ' ORDER BY role_groupe, prenom, nom';
      const rows = getDb().prepare(sql).all(...params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    'create_personne',
    "Ajoute une personne à l'annuaire du groupe.",
    {
      prenom: z.string().min(1),
      nom: z.string().optional(),
      email: z.string().email().optional(),
      telephone: z.string().optional(),
      role_groupe: z.enum(ROLES).optional(),
      unite_id: z.string().optional(),
      depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    ({ prenom, nom, email, telephone, role_groupe, unite_id, depuis, notes }) => {
      const ctx = getCurrentContext();
      const id = nextPersonneId(ctx.groupId, prenom, nom ?? null);
      const now = currentTimestamp();
      getDb().prepare(
        `INSERT INTO personnes (id, group_id, prenom, nom, email, telephone, role_groupe, unite_id, statut, depuis, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?, ?, ?)`
      ).run(id, ctx.groupId, prenom, nom ?? null, email ?? null, telephone ?? null, role_groupe ?? null, unite_id ?? null, depuis ?? null, notes ?? null, now, now);
      return { content: [{ type: 'text', text: `Personne ${id} créée : ${prenom}${nom ? ' ' + nom : ''}.` }] };
    }
  );

  server.tool(
    'update_personne',
    "Met à jour une personne existante. Pour clore un mandat, renseigner jusqu_a et/ou passer statut à 'ancien'.",
    {
      id: z.string(),
      prenom: z.string().optional(),
      nom: z.string().nullable().optional(),
      email: z.string().email().nullable().optional(),
      telephone: z.string().nullable().optional(),
      role_groupe: z.enum(ROLES).nullable().optional(),
      unite_id: z.string().nullable().optional(),
      statut: z.enum(['actif', 'ancien', 'inactif']).optional(),
      depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      jusqu_a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    (args) => {
      const { id, ...rest } = args;
      const fields: string[] = [];
      const values: (string | null)[] = [];
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue;
        fields.push(`${k} = ?`);
        values.push(v as string | null);
      }
      if (fields.length === 0) {
        return { content: [{ type: 'text', text: 'Rien à mettre à jour.' }], isError: true };
      }
      fields.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(id);
      const info = getDb().prepare(`UPDATE personnes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucune personne trouvée avec l'id ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Personne ${id} mise à jour.` }] };
    }
  );
}
