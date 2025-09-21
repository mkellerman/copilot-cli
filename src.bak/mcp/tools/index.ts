import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCopilotTool } from './tool-copilot.js';
import { registerCopilotAuthTool } from './tool-copilot-auth.js';

export function registerTools(server: McpServer): void {
  registerCopilotTool(server);
  registerCopilotAuthTool(server);
}
