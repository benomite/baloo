import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { recherche } from '@/lib/services/recherche';

export function registerRechercheTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'recherche',
    'Recherche libre dans toutes les tables (écritures, remboursements, abandons, caisse, chèques).',
    {
      query: z.string().min(1).describe('Terme de recherche'),
      tables: z
        .array(z.enum(['ecritures', 'remboursements', 'abandons', 'caisse', 'cheques']))
        .optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async (params) => {
      const results = await recherche({ groupId: ctx.groupId }, params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
