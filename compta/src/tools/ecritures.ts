import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount, parseAmount } from '../utils.js';

interface EcritureRow {
  id: string;
  amount_cents: number;
  [key: string]: unknown;
}

interface ListEcrituresResponse {
  ecritures: EcritureRow[];
  total: number;
}

export function registerEcritureTools(server: McpServer) {
  server.tool(
    'list_ecritures',
    'Liste les écritures (dépenses/recettes) avec filtres optionnels',
    {
      unite_id: z.string().optional().describe('Filtrer par unité (ex: u-lj)'),
      category_id: z.string().optional().describe('Filtrer par catégorie (ex: cat-intendance)'),
      type: z.enum(['depense', 'recette']).optional().describe('Filtrer par type'),
      date_debut: z.string().optional().describe('Date début (YYYY-MM-DD)'),
      date_fin: z.string().optional().describe('Date fin (YYYY-MM-DD)'),
      mode_paiement_id: z.string().optional().describe('Filtrer par mode de paiement'),
      status: z.enum(['brouillon', 'valide', 'saisie_comptaweb']).optional(),
      search: z.string().optional().describe('Recherche dans description et notes'),
      limit: z.number().default(50).describe('Nombre max de résultats'),
      offset: z.number().default(0),
    },
    async (params) => {
      const data = await api.get<ListEcrituresResponse>('/api/ecritures', params);
      const result = {
        total: data.total,
        ecritures: data.ecritures.map((e) => ({ ...e, montant: formatAmount(e.amount_cents) })),
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_ecriture',
    'Crée une nouvelle écriture (dépense ou recette)',
    {
      date_ecriture: z.string().describe("Date de l'écriture (YYYY-MM-DD)"),
      description: z.string().describe("Description de l'opération"),
      montant: z.string().describe('Montant (ex: "42,50" ou "42.50")'),
      type: z.enum(['depense', 'recette']).describe('Type : dépense ou recette'),
      unite_id: z.string().optional().describe('Unité concernée (ex: u-lj)'),
      category_id: z.string().optional().describe('Catégorie (ex: cat-intendance)'),
      mode_paiement_id: z.string().optional().describe('Mode de paiement (ex: mp-cb-sgdf)'),
      activite_id: z.string().optional().describe('Activité (ex: act-annee)'),
      numero_piece: z.string().optional().describe('Numéro de pièce'),
      justif_attendu: z.boolean().optional().describe("Défaut true. Mettre à false pour les prélèvements auto SGDF / flux territoriaux qui n'auront jamais de justif papier."),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<EcritureRow>('/api/ecritures', {
        date_ecriture: params.date_ecriture,
        description: params.description,
        amount_cents: parseAmount(params.montant),
        type: params.type,
        unite_id: params.unite_id ?? null,
        category_id: params.category_id ?? null,
        mode_paiement_id: params.mode_paiement_id ?? null,
        activite_id: params.activite_id ?? null,
        numero_piece: params.numero_piece ?? null,
        justif_attendu: params.justif_attendu,
        notes: params.notes ?? null,
      });
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...created, montant: formatAmount(created.amount_cents) }, null, 2) },
        ],
      };
    },
  );

  server.tool(
    'update_ecriture',
    'Met à jour une écriture existante (statut, notes, catégorie, etc.)',
    {
      id: z.string().describe("ID de l'écriture (ex: DEP-2026-001)"),
      description: z.string().optional(),
      montant: z.string().optional().describe('Nouveau montant (ex: "42,50")'),
      unite_id: z.string().optional(),
      category_id: z.string().optional(),
      mode_paiement_id: z.string().optional(),
      activite_id: z.string().optional(),
      numero_piece: z.string().optional(),
      justif_attendu: z.boolean().optional().describe("false = justif non attendu (prélèvement auto SGDF, flux territoire). Retire l'écriture du compteur 'sans justif' et débloque la sync."),
      status: z.enum(['brouillon', 'valide', 'saisie_comptaweb']).optional(),
      comptaweb_synced: z.boolean().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const { id, montant, ...rest } = params;
      const patch: Record<string, unknown> = { ...rest };
      if (montant !== undefined) patch.amount_cents = parseAmount(montant);
      const updated = await api.patch<EcritureRow>(`/api/ecritures/${encodeURIComponent(id)}`, patch);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...updated, montant: formatAmount(updated.amount_cents) }, null, 2) },
        ],
      };
    },
  );
}
