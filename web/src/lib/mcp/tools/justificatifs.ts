import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listJustificatifs } from '@/lib/services/justificatifs';

// NB : `attach_justificatif` et `upload_justificatif_orphan` NE SONT PAS
// portés côté MCP HTTP (décisions actées dans le brief Task 2) :
// multipart filesystem-local impossible en MCP HTTP. L'upload reste
// UI-only via le drag-and-drop /api/depots/upload.
export function registerJustificatifTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_justificatifs',
    'Liste les justificatifs attachés à une entité ou tous les justificatifs du groupe.',
    {
      entity_type: z.string().optional(),
      entity_id: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (params) => {
      const rows = await listJustificatifs({ groupId: ctx.groupId }, params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );
}
