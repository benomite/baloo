// Tools MCP pour piloter la sync incrémentale Comptaweb (Phase 2 Task 5).
//
// Deux tools exposés :
//   - sync_run({force?})  → lance un cycle de sync (bloquant côté MCP)
//   - sync_status()       → renvoie l'état courant (last_run, stale, etc.)
//
// Helper `withSyncFresh` exporté pour wrapper d'autres tools comptables
// sensibles (list_ecritures, vue_ensemble, cw_list_rapprochement_bancaire)
// : ils s'assurent qu'on a une sync fraîche avant de répondre.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpContext } from '../auth';
import { getDb } from '@/lib/db';
import {
  runSyncCycle,
  getSyncStatus,
  ensureSyncFresh,
  type SyncTrigger,
} from '@/lib/services/sync-cycle';

export function registerSyncTools(server: McpServer, ctx: McpContext) {
  server.tool(
    'sync_run',
    "Lance un cycle de sync incrémentale avec Comptaweb pour le groupe courant : promeut les écritures pending_sync en mirror par matching cw_numero_piece, met à jour les drafts depuis les lignes bancaires non rapprochées, détecte les écritures divergentes. Respecte le throttle 15 min sauf si force=true. Le verrou de concurrence (60s) ne peut pas être bypassé.",
    {
      force: z
        .boolean()
        .optional()
        .describe('Override du throttle 15 min (un sync ok récent). Le verrou running < 60s reste appliqué.'),
    },
    async ({ force }) => {
      const result = await runSyncCycle(getDb(), ctx.groupId, {
        trigger: 'mcp' as SyncTrigger,
        force: Boolean(force),
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: result.status === 'failed',
      };
    },
  );

  server.tool(
    'sync_status',
    "Retourne l'état de la sync Comptaweb pour le groupe courant : dernier run (id, status, started_at, finished_at, counts), si un run est en cours, si les données sont stales (>15 min) et jusqu'à quand le throttle bloque les nouveaux sync.",
    {},
    async () => {
      const status = await getSyncStatus(getDb(), ctx.groupId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      };
    },
  );
}

/**
 * Wrap un handler de tool MCP comptable pour garantir une sync fraîche
 * avant de répondre. Si la sync est stale (>15 min) et qu'aucun run
 * n'est en cours pour ce groupe, lance un cycle bloquant. Sinon no-op.
 *
 * Usage type :
 *   server.tool('list_ecritures', '...', schema, async (input) => {
 *     return withSyncFresh(ctx.groupId, async () => {
 *       // logique du tool, avec données fraîches garanties
 *     });
 *   });
 *
 * Pas d'usage dans les server actions / pages : c'est le composant
 * `<SyncStatusButton>` qui pilote côté front.
 */
export async function withSyncFresh<T>(
  groupId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await ensureSyncFresh(getDb(), groupId, 'mcp');
  return fn();
}
