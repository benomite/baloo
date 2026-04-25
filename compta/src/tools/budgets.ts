import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';
import { formatAmount, parseAmount } from '../utils.js';

const STATUTS = ['projet', 'vote', 'cloture'] as const;

interface BudgetRow {
  id: string;
  [key: string]: unknown;
}

interface BudgetLigneRow {
  id: string;
  amount_cents: number;
  [key: string]: unknown;
}

interface BudgetLignesResponse {
  lignes: BudgetLigneRow[];
  total_depenses_cents: number;
  total_recettes_cents: number;
  solde_cents: number;
}

export function registerBudgetTools(server: McpServer) {
  server.tool(
    'list_budgets',
    'Liste les budgets annuels du groupe.',
    { saison: z.string().optional() },
    async (params) => {
      const rows = await api.get<BudgetRow[]>('/api/budgets', params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'create_budget',
    "Crée un budget annuel (saison ex: '2025-2026').",
    {
      saison: z.string().min(4).describe("Format '2025-2026'"),
      statut: z.enum(STATUTS).optional(),
      vote_le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      notes: z.string().optional(),
    },
    async (params) => {
      const created = await api.post<BudgetRow>('/api/budgets', params);
      return { content: [{ type: 'text', text: `Budget ${created.id} créé (saison ${params.saison}).` }] };
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
      notes: z.string().optional(),
    },
    async (params) => {
      const { budget_id, amount, ...rest } = params;
      const cents = parseAmount(amount);
      const created = await api.post<BudgetLigneRow>(`/api/budgets/${encodeURIComponent(budget_id)}/lignes`, {
        ...rest,
        amount_cents: cents,
      });
      return { content: [{ type: 'text', text: `Ligne ${created.id} ajoutée : ${rest.libelle} (${formatAmount(cents)}).` }] };
    },
  );

  server.tool(
    'list_budget_lignes',
    "Liste les lignes d'un budget, avec totaux par type.",
    { budget_id: z.string() },
    async (params) => {
      const data = await api.get<BudgetLignesResponse>(`/api/budgets/${encodeURIComponent(params.budget_id)}/lignes`);
      const result = {
        lignes: data.lignes.map((l) => ({ ...l, montant: formatAmount(l.amount_cents) })),
        total_depenses: formatAmount(data.total_depenses_cents),
        total_recettes: formatAmount(data.total_recettes_cents),
        solde: formatAmount(data.solde_cents),
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
