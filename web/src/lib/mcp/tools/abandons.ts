import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listAbandons,
  createAbandon,
  updateAbandon,
  getAbandon,
  editAbandon,
  canEditAbandon,
} from '@/lib/services/abandons';
import { formatAmount, parseAmount } from '@/lib/format';
import { applyAbandonTransition } from '@/lib/services/abandon-transition';
import { currentTimestamp } from '@/lib/ids';

const ABANDON_STATUS = z.enum(['a_traiter', 'valide', 'envoye_national', 'refuse']);

export function registerAbandonTools(server: McpServer, ctx: McpContext) {
  const abandonCtx = { groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds ?? null };

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
    'Met à jour un abandon de frais. Champs métier (donateur, montant, date, nature, unité) : modifiables uniquement tant que la demande est `a_traiter`, par le demandeur ou un trésorier/RG — l’année fiscale suit la date. Notes et métadonnées (CERFA émis, envoi national, motif refus) : à tout moment. Pour changer le statut, utilisez `transition_abandon`. Pas d’ajout de pièce via MCP (upload UI uniquement).',
    {
      id: z.string().describe("ID de l'abandon (ex: ABF-2026-001)"),
      // status RETIRÉ — utiliser transition_abandon
      prenom: z.string().optional(),
      nom: z.string().optional(),
      email: z.string().email().nullable().optional(),
      montant: z.string().optional().describe('Montant abandonné (ex: "42,50")'),
      date_depense: z.string().optional().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().optional(),
      unite_id: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      cerfa_emis: z.boolean().optional().describe('Le CERFA fiscal a-t-il été émis ?'),
      cerfa_emis_at: z.string().nullable().optional(),
      sent_to_national_at: z.string().nullable().optional(),
      motif_refus: z.string().nullable().optional(),
    },
    async (params) => {
      const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
      const { id, prenom, nom, email, montant, date_depense, nature, unite_id, notes, ...meta } =
        params;

      const touchesFields = [prenom, nom, email, montant, date_depense, nature, unite_id].some(
        (v) => v !== undefined,
      );
      let updated = null;

      if (touchesFields) {
        const existing = await getAbandon(abandonCtx, id);
        if (!existing) return text(`Abandon ${id} introuvable.`);
        const isAdmin = ctx.role === 'tresorier' || ctx.role === 'RG';
        const isOwner =
          !!existing.submitted_by_user_id && existing.submitted_by_user_id === ctx.userId;
        if (!canEditAbandon(existing.status, { isAdmin, isOwner })) {
          return text(
            `Abandon ${id} non modifiable : statut « ${existing.status} » (seul « a_traiter » est éditable, par le demandeur ou un trésorier/RG).`,
          );
        }
        const newPrenom = prenom ?? existing.prenom;
        const newNom = nom ?? existing.nom;
        const date = date_depense ?? existing.date_depense;
        updated = await editAbandon(abandonCtx, id, {
          donateur:
            prenom !== undefined || nom !== undefined
              ? [newPrenom, newNom].filter(Boolean).join(' ')
              : existing.donateur,
          prenom: newPrenom,
          nom: newNom,
          email: email !== undefined ? email : existing.email,
          amount_cents: montant !== undefined ? parseAmount(montant) : existing.amount_cents,
          date_depense: date,
          nature: nature ?? existing.nature,
          unite_id: unite_id !== undefined ? unite_id : existing.unite_id,
          annee_fiscale: date_depense !== undefined ? date.slice(0, 4) : existing.annee_fiscale,
          notes: notes !== undefined ? notes : existing.notes,
        });
        if (!updated) return text(`Abandon ${id} a changé de statut entre-temps, rien modifié.`);
        if (Object.values(meta).some((v) => v !== undefined)) {
          updated = await updateAbandon(abandonCtx, id, meta);
        }
      } else {
        updated = await updateAbandon(abandonCtx, id, { ...meta, notes });
      }

      if (!updated) return text(`Abandon ${id} introuvable.`);
      return text(
        JSON.stringify({ ...updated, montant: formatAmount(updated.amount_cents) }, null, 2),
      );
    },
  );
}
