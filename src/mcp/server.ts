import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/index.js';

export interface McpServerOptions {
  version?: string;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = new McpServer({
    name: 'copilot-cli-mcp',
    version: options.version ?? '0.0.0'
  });

  registerTools(server);

  const transport = new StdioServerTransport();

  await server.connect(transport);

  const shutdown = async () => {
    await transport.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
}
