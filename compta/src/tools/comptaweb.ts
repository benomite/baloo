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

  server.tool(
    'cw_cleanup_dedup',
    "Détecte ou supprime les doublons d'écritures Comptaweb. mode='preview' liste les candidats ; mode='apply' supprime ceux dont les ids sont fournis.",
    {
      mode: z.enum(['preview', 'apply']),
      ids: z
        .array(z.string())
        .optional()
        .describe("Liste des loser_id à supprimer (obligatoire si mode=apply)"),
    },
    async (params) => {
      const data = await api.post('/api/comptaweb/cleanup/dedup', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cw_cleanup_transferts',
    "Détecte ou supprime les transferts internes mal importés (préfixe DEP-, patterns dépôt). mode='preview' liste, mode='apply' supprime selon ids.",
    {
      mode: z.enum(['preview', 'apply']),
      ids: z.array(z.string()).optional(),
    },
    async (params) => {
      const data = await api.post('/api/comptaweb/cleanup/transferts', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cw_cleanup_orphelins',
    "Détecte ou supprime les ventilations orphelines (category_id NULL avec twin). mode='preview' liste, mode='apply' supprime selon ids.",
    {
      mode: z.enum(['preview', 'apply']),
      ids: z.array(z.string()).optional(),
    },
    async (params) => {
      const data = await api.post('/api/comptaweb/cleanup/orphelins', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
