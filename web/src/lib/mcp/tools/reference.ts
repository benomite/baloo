import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../auth';
import {
  listCategories,
  listModesPaiement,
  listUnites,
  listActivites,
} from '@/lib/services/reference';

export function registerReferenceTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'list_categories',
    'Liste toutes les catégories de dépense/recette (référentiel SGDF national, partagé entre groupes).',
    {},
    async () => {
      const rows = await listCategories();
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'list_unites',
    'Liste toutes les unités du groupe (Farfadets, LJ, SG, PC, CO, etc.).',
    {},
    async () => {
      const rows = await listUnites({ groupId: ctx.groupId });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'list_modes_paiement',
    'Liste tous les modes de paiement (CB, virement, espèces, chèque, ...).',
    {},
    async () => {
      const rows = await listModesPaiement();
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'list_activites',
    'Liste toutes les activités (ventilation) du groupe.',
    {},
    async () => {
      const rows = await listActivites({ groupId: ctx.groupId });
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );
}
