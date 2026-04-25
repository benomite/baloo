import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const JUSTIFICATIFS_DIR = join(__dirname, '..', '..', '..', 'justificatifs');

function getMimeType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimes: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
  };
  return ext ? (mimes[ext] ?? null) : null;
}

// DEPRECATED (chantier 1, doc/p2-pivot-webapp.md) : la logique métier de cet
// outil sera retirée au chantier 3 et remplacée par un appel HTTP à
// `web/src/lib/services/justificatifs.ts` (canonique). En attendant, on conserve
// l'implémentation directe pour ne rien casser côté trésorier.
export function registerJustificatifTools(server: McpServer) {
  server.tool(
    'attach_justificatif',
    'Attache un fichier justificatif (depuis inbox/ ou autre) à une entité (écriture, remboursement, etc.)',
    {
      source_path: z.string().describe('Chemin du fichier source (absolu ou relatif au projet)'),
      entity_type: z.enum(['ecriture', 'remboursement', 'abandon', 'depot', 'mouvement']).describe('Type d\'entité'),
      entity_id: z.string().describe('ID de l\'entité (ex: RBT-2026-001)'),
    },
    (params) => {
      if (!existsSync(params.source_path)) {
        return { content: [{ type: 'text', text: `Fichier non trouvé : ${params.source_path}` }] };
      }

      const id = nextId('JUS');
      const originalFilename = basename(params.source_path);
      const destDir = join(JUSTIFICATIFS_DIR, params.entity_type, params.entity_id);
      mkdirSync(destDir, { recursive: true });
      const destPath = join(destDir, originalFilename);

      copyFileSync(params.source_path, destPath);

      const relativePath = join(params.entity_type, params.entity_id, originalFilename);
      const mimeType = getMimeType(originalFilename);
      const now = currentTimestamp();

      getDb().prepare(`
        INSERT INTO justificatifs (id, group_id, file_path, original_filename, mime_type, entity_type, entity_id, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, getCurrentContext().groupId, relativePath, originalFilename, mimeType, params.entity_type, params.entity_id, now);

      const row = getDb().prepare('SELECT * FROM justificatifs WHERE id = ?').get(id);
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    }
  );

  server.tool(
    'list_justificatifs',
    'Liste les justificatifs attachés à une entité ou tous les justificatifs',
    {
      entity_type: z.string().optional(),
      entity_id: z.string().optional(),
      limit: z.number().default(50),
    },
    (params) => {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (params.entity_type) { conditions.push('entity_type = ?'); values.push(params.entity_type); }
      if (params.entity_id) { conditions.push('entity_id = ?'); values.push(params.entity_id); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(params.limit);

      const rows = getDb().prepare(
        `SELECT * FROM justificatifs ${where} ORDER BY uploaded_at DESC LIMIT ?`
      ).all(...values);

      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
  );
}
