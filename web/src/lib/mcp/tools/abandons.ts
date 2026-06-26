import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listAbandons, createAbandon, updateAbandon } from '@/lib/services/abandons';
import { formatAmount, parseAmount } from '@/lib/format';
import { applyAbandonTransition } from '@/lib/services/abandon-transition';
import { currentTimestamp } from '@/lib/ids';

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
    'transition_abandon',
    'Change le statut d’un abandon de frais en appliquant les règles de workflow. Statuts possibles : valide, envoye_national, refuse. Pour changer le statut, utilisez ce tool plutôt que `update_abandon`.',
    {
      id: z.string().describe("ID de l'abandon (ex: ABF-2026-001)"),
      target_status: z.enum(['valide', 'envoye_national', 'refuse'] as const).describe('Statut cible'),
      motif: z.string().optional().describe('Motif de refus (requis si target_status = "refuse")'),
    },
    async (params) => {
      const opts: { motif?: string; sentToNationalAt?: string | null } = {};
      if (params.target_status === 'refuse') opts.motif = params.motif;
      if (params.target_status === 'envoye_national') opts.sentToNationalAt = currentTimestamp();

      const result = await applyAbandonTransition(
        { groupId: ctx.groupId, role: ctx.role, userId: ctx.userId },
        params.id,
        params.target_status,
        opts,
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'update_abandon',
    'Met à jour les métadonnées d’un abandon de frais (CERFA émis, notes, motif refus…). Pour changer le statut, utilisez `transition_abandon` qui applique les règles de workflow.',
    {
      id: z.string().describe("ID de l'abandon (ex: ABF-2026-001)"),
      // status RETIRÉ — utiliser transition_abandon
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
