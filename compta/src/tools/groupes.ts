import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { currentTimestamp, getDb } from '../db.js';
import { getCurrentContext } from '../context.js';

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : la logique métier de cet
// outil sera retirée au chantier 3 et remplacée par un appel HTTP à
// `web/src/lib/services/groupes.ts` (canonique). En attendant, on conserve
// l'implémentation directe pour ne rien casser côté trésorier.
export function registerGroupeTools(server: McpServer) {
  server.tool(
    'get_groupe',
    "Renvoie les informations du groupe courant.",
    {},
    () => {
      const { groupId } = getCurrentContext();
      const row = getDb().prepare('SELECT * FROM groupes WHERE id = ?').get(groupId);
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    }
  );

  server.tool(
    'update_groupe',
    "Met à jour les informations du groupe courant (nom, territoire, adresse, email, IBAN principal).",
    {
      nom: z.string().optional(),
      territoire: z.string().nullable().optional(),
      adresse: z.string().nullable().optional(),
      email_contact: z.string().nullable().optional(),
      iban_principal: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    (args) => {
      const { groupId } = getCurrentContext();
      const fields: string[] = [];
      const values: (string | null)[] = [];
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined) continue;
        fields.push(`${k} = ?`);
        values.push(v as string | null);
      }
      if (fields.length === 0) {
        return { content: [{ type: 'text', text: 'Rien à mettre à jour.' }], isError: true };
      }
      fields.push('updated_at = ?');
      values.push(currentTimestamp());
      values.push(groupId);
      const info = getDb().prepare(`UPDATE groupes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      if (info.changes === 0) {
        return { content: [{ type: 'text', text: `Groupe ${groupId} introuvable.` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Groupe ${groupId} mis à jour.` }] };
    }
  );
}
