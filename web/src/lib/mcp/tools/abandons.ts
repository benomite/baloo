import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listAbandons, createAbandon, updateAbandon } from '@/lib/services/abandons';
import { formatAmount, parseAmount } from '@/lib/format';

const ABANDON_STATUS = z.enum(['a_traiter', 'valide', 'envoye_national', 'refuse']);

export function registerAbandonTools(server: McpServer, ctx: McpContext) {
  const abandonCtx = { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId ?? null };

  server.tool(
    'list_abandons',
    "Liste les abandons de frais (dépenses non remboursées, don à l'asso).",
    {
      annee_fiscale: z.string().optional().describe('Filtrer par année fiscale (ex: "2025")'),
      donateur: z.string().optional(),
      status: ABANDON_STATUS.optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (params) => {
      const rows = await listAbandons(abandonCtx, params);
      const result = rows.map((r) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_abandon',
    "Enregistre un abandon de frais (don à l'asso ouvrant droit à reçu fiscal).",
    {
      donateur: z.string().describe('Nom de la personne'),
      prenom: z.string().optional(),
      nom: z.string().optional(),
      email: z.string().email().optional(),
      montant: z.string().describe('Montant abandonné (ex: "42,50")'),
      date_depense: z.string().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().describe('Nature de la dépense'),
      unite_id: z.string().optional(),
      annee_fiscale: z.string().describe('Année fiscale pour le CERFA (ex: "2025")'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createAbandon(abandonCtx, {
        donateur: params.donateur,
        prenom: params.prenom ?? null,
        nom: params.nom ?? null,
        email: params.email ?? null,
        amount_cents: parseAmount(params.montant),
        date_depense: params.date_depense,
        nature: params.nature,
        unite_id: params.unite_id ?? null,
        annee_fiscale: params.annee_fiscale,
        notes: params.notes ?? null,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ...created, montant: formatAmount(created.amount_cents) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'update_abandon',
    'Met à jour un abandon de frais (statut, CERFA émis, notes, motif refus...).',
    {
      id: z.string().describe("ID de l'abandon (ex: ABF-2026-001)"),
      status: ABANDON_STATUS.optional(),
      cerfa_emis: z.boolean().optional().describe('Le CERFA fiscal a-t-il été émis ?'),
      cerfa_emis_at: z.string().nullable().optional(),
      sent_to_national_at: z.string().nullable().optional(),
      motif_refus: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await updateAbandon(abandonCtx, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Abandon ${id} introuvable.` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ...updated, montant: formatAmount(updated.amount_cents) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
