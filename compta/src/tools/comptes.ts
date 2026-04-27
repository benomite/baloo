import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

const TYPES = ['courant', 'livret', 'caisse', 'autre'] as const;
const STATUTS = ['actif', 'ferme'] as const;

interface CompteRow {
  id: string;
  [key: string]: unknown;
}

export function registerCompteTools(server: McpServer) {
  server.tool(
    'list_comptes_bancaires',
    'Liste les comptes bancaires du groupe (comptes courants, livrets, caisses).',
    { statut: z.enum(STATUTS).optional() },
    async (params) => {
      const rows = await api.get<CompteRow[]>('/api/comptes-bancaires', params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_compte_bancaire',
    'Ajoute un compte bancaire, livret ou caisse au groupe.',
    {
      code: z.string().min(1).describe("Identifiant court (ex: 'bnp-principal', 'livret-a')"),
      nom: z.string().min(1),
      banque: z.string().optional(),
      iban: z.string().optional(),
      bic: z.string().optional(),
      type_compte: z.enum(TYPES).optional(),
      comptaweb_id: z.number().optional().describe('ID du compte dans Comptaweb (pour rapprochement)'),
      ouvert_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<CompteRow>('/api/comptes-bancaires', params);
      return { content: [{ type: 'text', text: `Compte ${created.id} créé : ${params.nom}.` }] };
    },
  );

  server.tool(
    'update_compte_bancaire',
    'Met à jour un compte (statut, notes, IBAN, etc.).',
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
    async (params) => {
      const { id, ...patch } = params;
      await api.patch(`/api/comptes-bancaires/${encodeURIComponent(id)}`, patch);
      return { content: [{ type: 'text', text: `Compte ${id} mis à jour.` }] };
    },
  );
}
