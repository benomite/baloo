import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listRemboursements,
  createRemboursement,
  updateRemboursement,
} from '@/lib/services/remboursements';
import { applyRemboursementTransition } from '@/lib/services/remboursement-transition';
import { REMBOURSEMENT_STATUSES } from '@/lib/types';
import { formatAmount, parseAmount } from '@/lib/format';
import { getDb } from '@/lib/db';

const RBT_STATUS = z.enum(REMBOURSEMENT_STATUSES);

export function registerRemboursementTools(server: McpServer, ctx: McpContext) {
  const rbtCtx = {
    groupId: ctx.groupId,
    scopeUniteId: ctx.scopeUniteId ?? null,
  };

  server.tool(
    'list_remboursements',
    'Liste les demandes de remboursement avec filtres optionnels.',
    {
      status: RBT_STATUS.optional(),
      unite_id: z.string().optional(),
      demandeur: z.string().optional().describe('Filtrer par nom du demandeur (recherche partielle)'),
      search: z.string().optional().describe('Recherche dans demandeur, nature et notes'),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (params) => {
      const rows = await listRemboursements(rbtCtx, params);
      const result = rows.map((r) => ({ ...r, montant: formatAmount(r.amount_cents) }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_remboursement',
    'Crée une nouvelle demande de remboursement.',
    {
      demandeur: z.string().describe('Nom de la personne qui demande le remboursement'),
      montant: z.string().describe('Montant (ex: "42,50")'),
      date_depense: z.string().describe('Date de la dépense (YYYY-MM-DD)'),
      nature: z.string().describe('Nature de la dépense (transport, intendance, etc.)'),
      unite_id: z.string().optional().describe('Unité concernée (ex: u-lj)'),
      justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
      mode_paiement_id: z.string().optional().describe('Mode de paiement souhaité'),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createRemboursement(rbtCtx, {
        demandeur: params.demandeur,
        amount_cents: parseAmount(params.montant),
        date_depense: params.date_depense,
        nature: params.nature,
        unite_id: params.unite_id ?? null,
        justificatif_status: params.justificatif_status,
        mode_paiement_id: params.mode_paiement_id ?? null,
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
    'transition_remboursement',
    'Change le statut d’un remboursement en appliquant toutes les règles métier : validation de transition, garde `termine` sans écriture, signature électronique (valide_tresorier/valide_rg), notification email au soumetteur. Pour changer le statut, utilisez ce tool plutôt que `update_remboursement`.',
    {
      id: z.string().describe('ID du remboursement (ex: RBT-2026-001)'),
      target_status: z.enum([
        'valide_tresorier',
        'valide_rg',
        'virement_effectue',
        'termine',
        'refuse',
      ] as const).describe('Statut cible'),
      motif: z.string().optional().describe('Motif de refus (requis si target_status = "refuse")'),
    },
    async (params) => {
      // Résolution email/name depuis la BDD (McpContext n'expose pas ces champs)
      const userRow = await getDb()
        .prepare('SELECT email, nom_affichage FROM users WHERE id = ?')
        .get<{ email: string; nom_affichage: string | null }>(ctx.userId);

      const result = await applyRemboursementTransition(
        {
          groupId: ctx.groupId,
          role: ctx.role,
          userId: ctx.userId,
          email: userRow?.email ?? '',
          name: userRow?.nom_affichage ?? null,
          scopeUniteId: ctx.scopeUniteId ?? null,
        },
        params.id,
        params.target_status,
        { motif: params.motif },
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'update_remboursement',
    'Met à jour les métadonnées d’un remboursement (date de paiement, justificatif, écriture liée, notes…). Pour changer le statut, utilisez `transition_remboursement` qui applique les règles métier.',
    {
      id: z.string().describe('ID du remboursement (ex: RBT-2026-001)'),
      // status RETIRÉ — utiliser transition_remboursement
      date_paiement: z.string().nullable().optional().describe('Date du paiement effectif (YYYY-MM-DD)'),
      mode_paiement_id: z.string().nullable().optional(),
      justificatif_status: z.enum(['oui', 'en_attente', 'non']).optional(),
      comptaweb_synced: z.boolean().optional(),
      ecriture_id: z.string().nullable().optional().describe("ID de l'écriture liée dans le journal"),
      notes: z.string().nullable().optional(),
      motif_refus: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, ...patch } = params;
      const updated = await updateRemboursement(rbtCtx, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Remboursement ${id} introuvable.` }] };
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
