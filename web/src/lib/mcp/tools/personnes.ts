import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listPersonnes,
  createPersonne,
  updatePersonne,
  PERSONNE_ROLES,
} from '@/lib/services/personnes';

const ROLES_ENUM = z.enum(PERSONNE_ROLES);
const STATUT_ENUM = z.enum(['actif', 'ancien', 'inactif']);

export function registerPersonneTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_personnes',
    "Liste l'annuaire du groupe (trésoriers, secrétaires, chefs, parents, bénévoles...). Filtres optionnels.",
    {
      statut: STATUT_ENUM.optional(),
      role: z.string().optional().describe("Filtre par role_groupe (ex: 'co-rg', 'chef_unite')"),
      unite_id: z.string().optional(),
    },
    async (params) => {
      const rows = await listPersonnes(
        { groupId: ctx.groupId },
        {
          statut: params.statut,
          role: params.role,
          unite_id: params.unite_id,
        },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_personne',
    "Ajoute une personne à l'annuaire du groupe.",
    {
      prenom: z.string().min(1),
      nom: z.string().optional(),
      email: z.string().email().optional(),
      telephone: z.string().optional(),
      role_groupe: ROLES_ENUM.optional(),
      unite_id: z.string().optional(),
      depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createPersonne(
        { groupId: ctx.groupId },
        {
          prenom: params.prenom,
          nom: params.nom ?? null,
          email: params.email ?? null,
          telephone: params.telephone ?? null,
          role_groupe: params.role_groupe ?? null,
          unite_id: params.unite_id ?? null,
          depuis: params.depuis ?? null,
          notes: params.notes ?? null,
        },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `Personne ${created.id} créée : ${params.prenom}${params.nom ? ' ' + params.nom : ''}.`,
          },
        ],
      };
    },
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
      role_groupe: ROLES_ENUM.nullable().optional(),
      unite_id: z.string().nullable().optional(),
      statut: STATUT_ENUM.optional(),
      depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      jusqu_a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await updatePersonne({ groupId: ctx.groupId }, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Personne ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Personne ${id} mise à jour.` }] };
    },
  );
}
