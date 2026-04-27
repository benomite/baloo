import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from '../api-client.js';

interface ScanResponse {
  crees: number;
  existants: number;
  erreur?: string;
}

export function registerScanDraftsTool(server: McpServer) {
  server.tool(
    'cw_scan_drafts',
    "Scanne les lignes bancaires non rapprochées Comptaweb et crée un draft (status='brouillon') dans la table ecritures locale pour chaque ligne (ou sous-ligne DSP2) non encore matérialisée. Idempotent : ne recrée pas de draft si un existe déjà pour (ligne_bancaire_id, sous_index), et ne touche pas aux drafts déjà complétés ou synchronisés.",
    {},
    async () => {
      const result = await api.post<ScanResponse>('/api/drafts/scan');
      if (result.erreur) {
        return { content: [{ type: 'text', text: `Erreur : ${result.erreur}` }], isError: true };
      }
      const summary = {
        drafts_crees: result.crees,
        drafts_existants: result.existants,
      };
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );
}
