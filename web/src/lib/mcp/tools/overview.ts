import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../auth';
import { getOverview } from '@/lib/services/overview';

export function registerOverviewTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'vue_ensemble',
    "Vue d'ensemble de la trésorerie : soldes par compte, écritures récentes, alertes.",
    {},
    async () => {
      const overview = await getOverview({ groupId: ctx.groupId });
      return { content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }] };
    },
  );
}
