import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { listEcritures } from '@/lib/services/ecritures';

export function registerEcrituresTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_ecritures',
    'Liste les écritures comptables, filtrables par type, période, catégorie.',
    {
      type: z.enum(['depense', 'recette']).optional(),
      date_debut: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      date_fin: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      category_id: z.string().optional(),
      unite_id: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (params) => {
      const result = await listEcritures(
        { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId },
        params,
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
