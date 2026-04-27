import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { api, ApiError } from '../api-client.js';

interface JustificatifRow {
  id: string;
  [key: string]: unknown;
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

function guessMimeType(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] : undefined;
}

export function registerJustificatifTools(server: McpServer) {
  server.tool(
    'attach_justificatif',
    "Attache un fichier justificatif (depuis inbox/ ou autre) à une entité (écriture, remboursement, etc.)",
    {
      source_path: z.string().describe('Chemin du fichier source (absolu ou relatif au projet)'),
      entity_type: z
        .enum(['ecriture', 'remboursement', 'abandon', 'depot', 'mouvement'])
        .describe("Type d'entité"),
      entity_id: z.string().describe("ID de l'entité (ex: RBT-2026-001)"),
    },
    async (params) => {
      if (!existsSync(params.source_path)) {
        return { content: [{ type: 'text', text: `Fichier non trouvé : ${params.source_path}` }] };
      }

      const buffer = readFileSync(params.source_path);
      const filename = basename(params.source_path);
      const mime = guessMimeType(filename);

      const baseUrl = (process.env.BALOO_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
      const form = new FormData();
      form.set('entity_type', params.entity_type);
      form.set('entity_id', params.entity_id);
      form.set('file', new Blob([new Uint8Array(buffer)], mime ? { type: mime } : undefined), filename);

      const headers: Record<string, string> = {};
      const token = process.env.BALOO_API_TOKEN;
      if (token) headers.authorization = `Bearer ${token}`;

      const response = await fetch(`${baseUrl}/api/justificatifs`, {
        method: 'POST',
        body: form,
        headers,
      });
      const text = await response.text();
      if (!response.ok) {
        let body: unknown = text;
        try { body = JSON.parse(text); } catch { /* ignore */ }
        throw new ApiError(response.status, body);
      }
      const created: JustificatifRow = text ? JSON.parse(text) : {};
      return { content: [{ type: 'text', text: JSON.stringify(created, null, 2) }] };
    },
  );

  server.tool(
    'list_justificatifs',
    'Liste les justificatifs attachés à une entité ou tous les justificatifs',
    {
      entity_type: z.string().optional(),
      entity_id: z.string().optional(),
      limit: z.number().default(50),
    },
    async (params) => {
      const rows = await api.get<JustificatifRow[]>('/api/justificatifs', params);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );
}
