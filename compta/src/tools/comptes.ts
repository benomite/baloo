import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

const TYPES = ['courant', 'livret', 'caisse', 'autre'] as const;
const STATUTS = ['actif', 'ferme'] as const;

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextCompteId(groupId: string, code: string): string {
  const base = `cpt-${slugify(code)}`;
  const existing = getDb()
    .prepare('SELECT COUNT(*) AS n FROM comptes_bancaires WHERE group_id = ? AND id LIKE ?')
    .get(groupId, `${base}%`) as { n: number };
  return existing.n === 0 ? base : `${base}-${existing.n + 1}`;
}

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : la logique métier de cet
// outil sera retirée au chantier 3 et remplacée par un appel HTTP à
// `web/src/lib/services/comptes.ts` (canonique). En attendant, on conserve
// l'implémentation directe pour ne rien casser côté trésorier.
export function registerCompteTools(server: McpServer) {
  server.tool(
    'list_comptes_bancaires',
    "Liste les comptes bancaires du groupe (comptes courants, livrets, caisses).",
    { statut: z.enum(STATUTS).optional() },
    ({ statut }) => {
      const { groupId } = getCurrentContext();
      let sql = 'SELECT * FROM comptes_bancaires WHERE group_id = ?';
      const params: (string | number)[] = [groupId];
      if (statut) { sql += ' AND statut = ?'; params.push(statut); }
      else { sql += " AND statut = 'actif'"; }
      sql += ' ORDER BY type_compte, nom';
      const rows = getDb().prepare(sql).all(...params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    'create_compte_bancaire',
    "Ajoute un compte bancaire, livret ou caisse au groupe.",
    {
      code: z.string().min(1).describe("Identifiant court (ex: 'bnp-principal', 'livret-a')"),
      nom: z.string().min(1),
      banque: z.string().optional(),
      iban: z.string().optional(),
      bic: z.string().optional(),
      type_compte: z.enum(TYPES).optional(),
      comptaweb_id: z.number().optional().describe("ID du compte dans Comptaweb (pour rapprochement)"),
      ouvert_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    ({ code, nom, banque, iban, bic, type_compte, comptaweb_id, ouvert_le, notes }) => {
      const ctx = getCurrentContext();
      const id = nextCompteId(ctx.groupId, code);
      const now = currentTimestamp();
      getDb().prepare(
        `INSERT INTO comptes_bancaires (id, group_id, code, nom, banque, iban, bic, type_compte, comptaweb_id, statut, ouvert_le, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?, ?, ?)`
      ).run(id, ctx.groupId, code, nom, banque ?? null, iban ?? null, bic ?? null, type_compte ?? null, comptaweb_id ?? null, ouvert_le ?? null, notes ?? null, now, now);
      return { content: [{ type: 'text', text: `Compte ${id} créé : ${nom}.` }] };
    }
  );

  server.tool(
    'update_compte_bancaire',
    "Met à jour un compte (statut, notes, IBAN, etc.).",
    {
      id: z.string(),
      nom: z.string().optional(),
      banque: z.string().nullable().optional(),
      iban: z.string().nullable().optional(),
      bic: z.string().nullable().optional(),
      type_compte: z.enum(TYPES).optional(),
      comptaweb_id: z.number().nullable().optional(),
      statut: z.enum(STATUTS).optional(),
      ouvert_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      ferme_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes: z.string().nullable().optional(),
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
      const info = getDb().prepare(`UPDATE comptes_bancaires SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Aucun compte trouvé avec l'id ${id}.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Compte ${id} mis à jour.` }] };
    }
  );
}
