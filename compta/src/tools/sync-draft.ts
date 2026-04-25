import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from '../api-client.js';

interface SyncResponse {
  ok: boolean;
  message: string;
  dryRun: boolean;
  ecritureId?: number;
  missingFields?: string[];
}

export function registerSyncDraftTool(server: McpServer) {
  server.tool(
    'cw_sync_draft',
    "Synchronise un draft BDD (status='brouillon') vers Comptaweb : crée l'écriture en prod, met à jour le draft en 'saisie_comptaweb' avec comptaweb_ecriture_id. Valide les obligatoires avant (nature/activité/unité/mode, justificatif si dépense). Dry-run par défaut.",
    {
      ecriture_id: z.string().describe("ID local de l'écriture draft (ex: ECR-2026-192)"),
      dry_run: z.boolean().optional().describe('Défaut true. Passer false pour réellement créer dans Comptaweb.'),
    },
    async ({ ecriture_id, dry_run }) => {
      const result = await api.post<SyncResponse>(
        `/api/drafts/${encodeURIComponent(ecriture_id)}/sync`,
        { dryRun: dry_run !== false },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        ...(result.ok ? {} : { isError: true }),
      };
    },
  );
}
