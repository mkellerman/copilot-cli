import { startMcpServer } from '../../../mcp/index.js';

interface McpOptions {
  debug?: boolean;
  version?: string;
}

export async function runMcpCommand(options: McpOptions): Promise<void> {
  if (options.debug) {
    process.env.DEBUG = 'true';
  }

  await startMcpServer({ version: options.version });
}
