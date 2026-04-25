import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount, parseAmount } from '../utils.js';

interface AbandonRow {
  id: string;
  amount_cents: number;
  [key: string]: unknown;
}

export function registerAbandonTools(server: McpServer) {
  server.tool(
    'list_abandons',
    "Liste les abandons de frais (dépenses non remboursées, don à l'asso)",
    {
      annee_fiscale: z.string().optional().describe('Filtrer par année fiscale (ex: "2025")'),
      donateur: z.string().optional(),
      limit: z.number().default(50),
    },
    async (params) => {
      const rows = await api.get<AbandonRow[]>('/api/abandons', params);
      const result = rows.map((r) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_abandon',
    "Enregistre un abandon de frais (don à l'asso ouvrant droit à reçu fiscal)",
    {
      donateur: z.string().describe('Nom de la personne'),
      montant: z.string().describe('Montant abandonné (ex: "42,50")'),
      date_depense: z.string().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().describe('Nature de la dépense'),
      unite_id: z.string().optional(),
      annee_fiscale: z.string().describe('Année fiscale pour le CERFA (ex: "2025")'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<AbandonRow>('/api/abandons', {
        donateur: params.donateur,
        amount_cents: parseAmount(params.montant),
        date_depense: params.date_depense,
        nature: params.nature,
        unite_id: params.unite_id ?? null,
        annee_fiscale: params.annee_fiscale,
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
    'update_abandon',
    'Met à jour un abandon de frais (CERFA émis, notes, etc.)',
    {
      id: z.string().describe("ID de l'abandon (ex: ABF-2026-001)"),
      cerfa_emis: z.boolean().optional().describe('Le CERFA fiscal a-t-il été émis ?'),
      notes: z.string().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await api.patch<AbandonRow>(`/api/abandons/${encodeURIComponent(id)}`, patch);
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );
}
