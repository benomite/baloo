import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from './auth';
import { registerOverviewTools } from './tools/overview';
import { registerEcrituresTools } from './tools/ecritures';
import { registerRechercheTools } from './tools/recherche';
import { registerReferenceTools } from './tools/reference';
import { registerPersonneTools } from './tools/personnes';
import { registerGroupeTools } from './tools/groupes';

// Compteur cible Phase 1 : 55 tools (3 historiques + 52 portés dans la
// Task 2 du pivot miroir strict). Décisions actées (cf.
// `doc/plans/2026-05-18-tools-portage-audit.md` + brief Task 2) :
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
}
