import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

interface OverviewResponse {
  totalDepenses: number;
  totalRecettes: number;
  solde: number;
  totalDepensesFormatted: string;
  totalRecettesFormatted: string;
  soldeFormatted: string;
  parUnite: { code: string; name: string; depenses: number; recettes: number; solde: number }[];
  remboursementsEnAttente: { count: number; total: number; totalFormatted: string };
  alertes: { depensesSansJustificatif: number; nonSyncComptaweb: number };
  dernierImport: { date: string; fichier: string } | null;
}

export function registerOverviewTools(server: McpServer) {
  server.tool(
    'vue_ensemble',
    "Vue d'ensemble de la trésorerie : soldes, répartition par unité, remboursements en attente, alertes",
    { saison: z.string().optional().describe('Filtre par saison (ex: "2025-2026"). Par défaut: saison courante') },
    async () => {
      const data = await api.get<OverviewResponse>('/api/overview');

      const result = {
        solde_global: {
          total_depenses: data.totalDepensesFormatted,
          total_recettes: data.totalRecettesFormatted,
          solde: data.soldeFormatted,
          depenses_cents: data.totalDepenses,
          recettes_cents: data.totalRecettes,
        },
        par_unite: data.parUnite,
        remboursements_en_attente: {
          count: data.remboursementsEnAttente.count,
          total: data.remboursementsEnAttente.totalFormatted,
        },
        alertes: {
          depenses_sans_justificatif: data.alertes.depensesSansJustificatif,
          non_sync_comptaweb: data.alertes.nonSyncComptaweb,
        },
        dernier_import_comptaweb: data.dernierImport,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
