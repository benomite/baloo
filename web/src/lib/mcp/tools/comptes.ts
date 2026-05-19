import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listComptesBancaires,
  createCompteBancaire,
  updateCompteBancaire,
  COMPTE_TYPES,
  COMPTE_STATUTS,
} from '@/lib/services/comptes';

const TYPE_ENUM = z.enum(COMPTE_TYPES);
const STATUT_ENUM = z.enum(COMPTE_STATUTS);

export function registerCompteTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_comptes_bancaires',
    'Liste les comptes bancaires du groupe (comptes courants, livrets, caisses).',
    { statut: STATUT_ENUM.optional() },
    async (params) => {
      const rows = await listComptesBancaires({ groupId: ctx.groupId }, { statut: params.statut });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
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
      type_compte: TYPE_ENUM.optional(),
      comptaweb_id: z.number().optional().describe('ID du compte dans Comptaweb (pour rapprochement)'),
      ouvert_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createCompteBancaire(
        { groupId: ctx.groupId },
        {
          code: params.code,
          nom: params.nom,
          banque: params.banque ?? null,
          iban: params.iban ?? null,
          bic: params.bic ?? null,
          type_compte: params.type_compte ?? null,
          comptaweb_id: params.comptaweb_id ?? null,
          ouvert_le: params.ouvert_le ?? null,
          notes: params.notes ?? null,
        },
      );
      return { content: [{ type: 'text' as const, text: `Compte ${created.id} créé : ${params.nom}.` }] };
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
      type_compte: TYPE_ENUM.optional(),
      comptaweb_id: z.number().nullable().optional(),
      statut: STATUT_ENUM.optional(),
      ouvert_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      ferme_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await updateCompteBancaire({ groupId: ctx.groupId }, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Compte ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Compte ${id} mis à jour.` }] };
    },
  );
}
