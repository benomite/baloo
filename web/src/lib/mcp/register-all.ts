import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from './auth';
import { registerOverviewTools } from './tools/overview';
import { registerEcrituresTools } from './tools/ecritures';
import { registerRechercheTools } from './tools/recherche';
import { registerReferenceTools } from './tools/reference';
import { registerPersonneTools } from './tools/personnes';
import { registerGroupeTools } from './tools/groupes';
import { registerCompteTools } from './tools/comptes';
import { registerCarteTools } from './tools/cartes';
import { registerNoteTools } from './tools/notes';
import { registerTodoTools } from './tools/todos';
import { registerBudgetTools } from './tools/budgets';
import { registerCaisseTools } from './tools/caisse';
import { registerChequesTools } from './tools/cheques';
import { registerDepotsEspecesTools } from './tools/depots-especes';
import { registerAbandonTools } from './tools/abandons';
import { registerRemboursementTools } from './tools/remboursements';
import { registerJustificatifTools } from './tools/justificatifs';
import { registerInboxTools } from './tools/inbox';
import { registerComptawebClientTools } from './tools/comptaweb-client';
import { registerSyncReferentielsTools } from './tools/sync-referentiels';
import { registerSyncTools } from './tools/sync';

// Compteur Phase 2 : 59 tools = 57 Phase 1 + 2 sync (sync_run +
// sync_status) ajoutés en Phase 2 Task 5 (orchestrateur sync incrémental
// Comptaweb).
//
// Phase 1 (57 = 3 historiques + 54 portés via Vagues 1-5). Décisions :
//  - 2 tools multipart (`attach_justificatif`, `upload_justificatif_orphan`)
//    NON portés : l'upload reste UI-only.
//  - 2 doublons CW (`cw_create_depense`, `cw_create_recette`) NON portés :
//    `create_ecriture` est le seul point d'entrée création (cycle
//    pending_cw → pending_sync via le service `createEcritureAndPushToCw`).
//  - 6 tools obsolètes NON portés (`import_comptaweb_csv`, `cw_cleanup_*`,
//    `cw_scan_drafts`, `cw_sync_draft`).
export function registerAllTools(server: McpServer, ctx: McpContext): void {
  // Phase 1 — tools historiques (3)
  registerOverviewTools(server, ctx);
  registerEcrituresTools(server, ctx);
  registerRechercheTools(server, ctx);

  // Vague 1 — Référentiels + Annuaire + Groupe (9 tools)
  registerReferenceTools(server, ctx);
  registerPersonneTools(server, ctx);
  registerGroupeTools(server, ctx);

  // Vague 2 — Comptes + Cartes + Notes + Todos + Budgets (18 tools)
  registerCompteTools(server, ctx);
  registerCarteTools(server, ctx);
  registerNoteTools(server, ctx);
  registerTodoTools(server, ctx);
  registerBudgetTools(server, ctx);

  // Vague 3 — Workflows opérationnels (16 tools : caisse 4 + cheques 2
  // + depots espèces 3 + abandons 3 + rembs 3 + justificatifs 1)
  registerCaisseTools(server, ctx);
  registerChequesTools(server, ctx);
  registerDepotsEspecesTools(server, ctx);
  registerAbandonTools(server, ctx);
  registerRemboursementTools(server, ctx);
  registerJustificatifTools(server, ctx);

  // Vague 4 — Écritures (3 tools : list_ecritures étendu, create_ecriture,
  // update_ecriture) : déjà inclus dans registerEcrituresTools ci-dessus.

  // Vague 5 — Inbox + Comptaweb interactions + Sync référentiels (9 tools)
  registerInboxTools(server, ctx);
  registerComptawebClientTools(server, ctx);
  registerSyncReferentielsTools(server, ctx);

  // Phase 2 — Sync incrémentale Comptaweb (2 tools)
  registerSyncTools(server, ctx);
}
