import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDb } from './db.js';
import { registerReferenceTools } from './tools/reference.js';
import { registerOverviewTools } from './tools/overview.js';
import { registerEcritureTools } from './tools/ecritures.js';
import { registerRemboursementTools } from './tools/remboursements.js';
import { registerAbandonTools } from './tools/abandons.js';
import { registerCaisseTools } from './tools/caisse.js';
import { registerChequesTools } from './tools/cheques.js';
import { registerJustificatifTools } from './tools/justificatifs.js';
import { registerComptawebTools } from './tools/comptaweb.js';
import { registerComptawebClientTools } from './tools/comptaweb-client.js';
import { registerScanDraftsTool } from './tools/scan-drafts.js';
import { registerSyncDraftTool } from './tools/sync-draft.js';
import { registerRechercheTools } from './tools/recherche.js';
import { registerTodoTools } from './tools/todos.js';
import { registerPersonneTools } from './tools/personnes.js';
import { registerNoteTools } from './tools/notes.js';
import { registerCompteTools } from './tools/comptes.js';
import { registerBudgetTools } from './tools/budgets.js';
import { registerGroupeTools } from './tools/groupes.js';

const server = new McpServer({
  name: 'baloo-compta',
  version: '0.1.0',
});

getDb();

registerReferenceTools(server);
registerOverviewTools(server);
registerEcritureTools(server);
registerRemboursementTools(server);
registerAbandonTools(server);
registerCaisseTools(server);
registerChequesTools(server);
registerJustificatifTools(server);
registerComptawebTools(server);
registerComptawebClientTools(server);
registerScanDraftsTool(server);
registerSyncDraftTool(server);
registerRechercheTools(server);
registerTodoTools(server);
registerPersonneTools(server);
registerNoteTools(server);
registerCompteTools(server);
registerBudgetTools(server);
registerGroupeTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
