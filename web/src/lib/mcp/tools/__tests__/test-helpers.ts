import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../../auth';

// Capture les tools enregistrés par un `register*Tools(server, ctx)` :
// permet de les invoquer en test sans monter de transport HTTP/Stdio MCP.
//
// Les tests ne s'intéressent qu'à la surface du tool (nom, description,
// schema d'entrée) et au retour MCP (JSON sérialisé), pas à l'effet
// BDD (qui est testé au niveau service ou via les routes API).

export interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (input?: Record<string, unknown>) => Promise<unknown>;
}

export function captureTools(
  register: (server: McpServer, ctx: McpContext) => void,
  ctx: Partial<McpContext> = {},
): Record<string, CapturedTool> {
  const tools: Record<string, CapturedTool> = {};
  const mockServer = {
    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (input?: Record<string, unknown>) => Promise<unknown>,
    ) {
      tools[name] = { name, description, schema, handler };
    },
  } as unknown as McpServer;

  const fullCtx: McpContext = {
    userId: 'u-test',
    groupId: 'g-test',
    role: 'tresorier',
    scopeUniteId: null,
    scope: 'mcp:read mcp:write',
    clientId: 'client-test',
    ...ctx,
  };

  register(mockServer, fullCtx);
  return tools;
}

// Parse le JSON renvoyé par un tool (content: [{ type: 'text', text: '<json>' }])
// pour faciliter les assertions. Si le texte n'est pas du JSON valide,
// retourne la chaîne brute (cas messages de confirmation).
export function parseToolResult(result: unknown): unknown {
  const r = result as { content?: Array<{ type: string; text: string }> };
  const txt = r.content?.[0]?.text;
  if (typeof txt !== 'string') return null;
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}
