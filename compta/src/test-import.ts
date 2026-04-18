import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerComptawebTools } from './tools/comptaweb.js';

// Petit harness pour tester import_comptaweb_csv sans MCP stdio.
const server = new McpServer({ name: 'test', version: '0.0.0' });

interface Captured {
  handler: (args: { csv_path: string }) => Promise<unknown> | unknown;
}
const captured: Captured = { handler: () => { throw new Error('not set'); } };

// Monkey-patch server.tool pour capturer le handler import_comptaweb_csv
const origTool = server.tool.bind(server);
(server as unknown as { tool: typeof origTool }).tool = ((
  name: string,
  desc: string,
  schema: unknown,
  handler: (args: { csv_path: string }) => unknown,
) => {
  if (name === 'import_comptaweb_csv') {
    captured.handler = handler;
  }
  return origTool(name as never, desc as never, schema as never, handler as never);
}) as typeof origTool;

registerComptawebTools(server);

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: tsx test-import.ts <csv_path>');
  process.exit(1);
}

const result = await captured.handler({ csv_path: csvPath });
console.log(JSON.stringify(result, null, 2));
