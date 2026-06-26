import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import {
  listBudgets,
  createBudget,
  createBudgetLigne,
  listBudgetLignes,
  updateBudgetLigne,
  deleteBudgetLigne,
  updateBudgetStatut,
} from '@/lib/services/budgets';
import { formatAmount, parseAmount } from '@/lib/format';

const STATUT_ENUM = z.enum(['projet', 'vote', 'cloture']);

export function registerBudgetTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_budgets',
    'Liste les budgets annuels du groupe.',
    { saison: z.string().optional() },
    async ({ saison }) => {
      const rows = await listBudgets({ groupId: ctx.groupId }, { saison });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_budget',
    "Crée un budget annuel (saison ex: '2025-2026').",
    {
      saison: z.string().min(4).describe("Format '2025-2026'"),
      statut: STATUT_ENUM.optional(),
      vote_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await createBudget({ groupId: ctx.groupId }, params);
      return { content: [{ type: 'text' as const, text: `Budget ${created.id} créé (saison ${params.saison}).` }] };
    },
  );

  server.tool(
    'create_budget_ligne',
    'Ajoute une ligne à un budget (poste budgétaire).',
    {
      budget_id: z.string(),
      libelle: z.string().min(1),
      type: z.enum(['depense', 'recette']),
      amount: z.string().describe("Montant en format français, ex: '19 000' ou '1 234,56'"),
      unite_id: z.string().optional(),
      category_id: z.string().optional(),
      activite_id: z.string().optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const cents = parseAmount(params.amount);
      const created = await createBudgetLigne(
        { groupId: ctx.groupId },
        {
          budget_id: params.budget_id,
          libelle: params.libelle,
          type: params.type,
          amount_cents: cents,
          unite_id: params.unite_id ?? null,
          category_id: params.category_id ?? null,
          activite_id: params.activite_id ?? null,
          notes: params.notes ?? null,
        },
      );
      if (!created) {
        return { content: [{ type: 'text' as const, text: `Budget ${params.budget_id} introuvable.` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Ligne ${created.id} ajoutée : ${params.libelle} (${formatAmount(cents)}).`,
          },
        ],
      };
    },
  );

  server.tool(
    'list_budget_lignes',
    "Liste les lignes d'un budget, avec totaux par type.",
    { budget_id: z.string() },
    async ({ budget_id }) => {
      const data = await listBudgetLignes({ groupId: ctx.groupId }, budget_id);
      const result = {
        lignes: data.lignes.map((l) => ({ ...l, montant: formatAmount(l.amount_cents) })),
        total_depenses: formatAmount(data.total_depenses_cents),
        total_recettes: formatAmount(data.total_recettes_cents),
        solde: formatAmount(data.solde_cents),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'update_budget_ligne',
    'Modifie une ligne budgétaire (libellé, montant, type, unité, catégorie, activité, notes).',
    {
      id: z.string().describe('ID de la ligne (ex: bdl-abcd-1234)'),
      libelle: z.string().min(1).optional(),
      type: z.enum(['depense', 'recette']).optional(),
      amount: z.string().optional().describe("Montant en format français, ex: '1 200' ou '1 234,56'"),
      unite_id: z.string().nullable().optional(),
      category_id: z.string().nullable().optional(),
      activite_id: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    },
    async (params) => {
      const { id, amount, ...rest } = params;
      const patch: Parameters<typeof updateBudgetLigne>[2] = { ...rest };
      if (amount !== undefined) {
        patch.amount_cents = parseAmount(amount);
      }
      const updated = await updateBudgetLigne({ groupId: ctx.groupId }, id, patch);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Ligne ${id} introuvable.` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...updated, montant: formatAmount(updated.amount_cents) }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'delete_budget_ligne',
    "Supprime une ligne budgétaire. Les lignes budget sont des données de planification (pas soumises à la règle 'jamais de DELETE').",
    { id: z.string().describe('ID de la ligne (ex: bdl-abcd-1234)') },
    async ({ id }) => {
      const deleted = await deleteBudgetLigne({ groupId: ctx.groupId }, id);
      if (!deleted) {
        return { content: [{ type: 'text' as const, text: `Ligne ${id} introuvable.` }] };
      }
      return { content: [{ type: 'text' as const, text: `Ligne ${id} supprimée.` }] };
    },
  );

  server.tool(
    'update_budget_statut',
    "Change le statut d'un budget (projet → vote → cloture). Pose automatiquement vote_le à la date du jour lors du passage à 'vote'.",
    {
      budget_id: z.string().describe("ID du budget (ex: bdg-g-test-2025-2026)"),
      statut: STATUT_ENUM,
    },
    async ({ budget_id, statut }) => {
      const updated = await updateBudgetStatut({ groupId: ctx.groupId }, budget_id, statut);
      if (!updated) {
        return { content: [{ type: 'text' as const, text: `Budget ${budget_id} introuvable.` }] };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(updated, null, 2),
          },
        ],
      };
    },
  );
}
