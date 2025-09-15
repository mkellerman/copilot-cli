import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCopilotTool(server: McpServer): void {
  server.tool(
    "copilot",
    "The copilot tool",
    {
      someEnum: z.enum(["option1", "option2", "option3"], {
        description: "An enum parameter"
      }),
      aNumber: z.number({
        description: "A number parameter"
      }),
      aString: z.string({
        description: "A string parameter"
      })
    },
    async (params) => {
      return {
        content: [{
          type: "text",
          text: "This is the tool response to the user's request"
        }]
      };
    }
  );
}