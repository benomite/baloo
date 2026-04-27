import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { api } from '../api-client.js';

interface ImportResult {
  ok: boolean;
  message?: string;
  [key: string]: unknown;
}

export function registerComptawebTools(server: McpServer) {
  server.tool(
    'import_comptaweb_csv',
    'Importe un export CSV Comptaweb (gestion courante recettes/dépenses) : remplit les tables de staging ET crée les écritures dans la table principale avec status=saisie_comptaweb. Idempotent par N° de pièce.',
    {
      csv_path: z.string().describe('Chemin vers le fichier CSV (typiquement dans inbox/)'),
    },
    async (params) => {
      if (!existsSync(params.csv_path)) {
        return { content: [{ type: 'text', text: `Fichier non trouvé : ${params.csv_path}` }], isError: true };
      }
      let content: string;
      try {
        content = readFileSync(params.csv_path, 'latin1');
      } catch {
        try {
          content = readFileSync(params.csv_path, 'utf-8');
        } catch (e) {
          return { content: [{ type: 'text', text: `Erreur lecture fichier : ${e}` }], isError: true };
        }
      }
      const result = await api.post<ImportResult>('/api/comptaweb/import-csv', {
        filename: basename(params.csv_path),
        content,
      });
      const { ok, message, ...details } = result;
      if (!ok) {
        return { content: [{ type: 'text', text: message ?? 'Import échoué.' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
    },
  );
}
