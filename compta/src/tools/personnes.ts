import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

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

interface PersonneRow {
  id: string;
  [key: string]: unknown;
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
    async (params) => {
      const rows = await api.get<PersonneRow[]>('/api/personnes', params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
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
      role_groupe: z.enum(ROLES).optional(),
      unite_id: z.string().optional(),
      depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<PersonneRow>('/api/personnes', params);
      return { content: [{ type: 'text', text: `Personne ${created.id} créée : ${params.prenom}${params.nom ? ' ' + params.nom : ''}.` }] };
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
      role_groupe: z.enum(ROLES).nullable().optional(),
      unite_id: z.string().nullable().optional(),
      statut: z.enum(['actif', 'ancien', 'inactif']).optional(),
      depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      jusqu_a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      await api.patch(`/api/personnes/${encodeURIComponent(id)}`, patch);
      return { content: [{ type: 'text', text: `Personne ${id} mise à jour.` }] };
    },
  );
}
