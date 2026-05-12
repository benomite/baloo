import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { ApiError } from '../api-client.js';

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function guessMimeType(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] : undefined;
}

export function registerUploadOrphanTool(server: McpServer) {
  server.tool(
    'upload_justificatif_orphan',
    "Upload un fichier (PDF/image) depuis un chemin local et crée un dépôt orphelin (statut a_traiter). Si ecriture_id est fourni, le dépôt est immédiatement attaché à cette écriture.",
    {
      file_path: z.string().describe('Chemin absolu ou relatif du fichier source'),
      titre: z.string().describe("Titre lisible du justificatif (ex: 'Facture Decathlon')"),
      montant_estime: z
        .string()
        .regex(/^-?\d+(,\d{1,2})?$/)
        .optional()
        .describe("Montant estimé au format FR (ex: '42,50')"),
      date_estimee: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Date estimée de la dépense au format ISO YYYY-MM-DD'),
      ecriture_id: z.string().optional().describe('Si fourni : attache direct à cette écriture'),
    },
    async (params) => {
      if (!existsSync(params.file_path)) {
        return { content: [{ type: 'text', text: `Fichier non trouvé : ${params.file_path}` }] };
      }

      const buffer = readFileSync(params.file_path);
      const filename = basename(params.file_path);
      const mime = guessMimeType(filename);

      const baseUrl = (process.env.BALOO_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      const form = new FormData();
      form.set('titre', params.titre);
      if (params.montant_estime) form.set('montant_estime', params.montant_estime);
      if (params.date_estimee) form.set('date_estimee', params.date_estimee);
      if (params.ecriture_id) form.set('ecriture_id', params.ecriture_id);
      form.set(
        'file',
        new Blob([new Uint8Array(buffer)], mime ? { type: mime } : undefined),
        filename,
      );

      const headers: Record<string, string> = {};
      const token = process.env.BALOO_API_TOKEN;
      if (token) headers.authorization = `Bearer ${token}`;

      const response = await fetch(`${baseUrl}/api/depots/upload`, {
        method: 'POST',
        body: form,
        headers,
      });
      const text = await response.text();
      if (!response.ok) {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* ignore */
        }
        throw new ApiError(response.status, body);
      }
      const created = text ? JSON.parse(text) : {};
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );
}
