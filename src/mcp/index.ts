import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCopilotTool } from "./tools/copilot.js";

const server = new McpServer({
  name: "copilot-cli-mcp",
  version: "1.0.0"
});

registerCopilotTool(server);

const transport = new StdioServerTransport();
await server.connect(transport);