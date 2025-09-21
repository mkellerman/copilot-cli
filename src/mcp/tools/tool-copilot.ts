import { z, type ZodRawShape } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConfigManager } from '../../core/config-manager.js';
import { CopilotHttpClient, type CopilotChatCompletionRequest } from '../../core/copilot-client.js';
import { getValidToken } from '../../core/auth.js';
import { loadAuthInfo, loadToken } from '../../config/index.js';

const MessageSchema = z.object({
  role: z.string().min(1),
  content: z.string().min(1)
});

const CopilotInputShape = {
  model: z.string().optional(),
  messages: z.array(MessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(8192).optional(),
  top_p: z.number().min(0).max(1).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  user: z.string().optional()
} satisfies ZodRawShape;

const CopilotInputSchema = z.object(CopilotInputShape);

export function registerCopilotTool(server: McpServer): void {
  server.tool(
    'copilot',
    'Proxy chat completions through GitHub Copilot',
    CopilotInputShape,
    async (params) => {
      const input = CopilotInputSchema.parse(params);

      if (input.messages.length === 0) {
        throw new Error('messages array must contain at least one message');
      }

      const token = await resolveToken();
      if (!token) {
        throw new Error('Not authenticated. Run: copilot profile login');
      }

      const config = ConfigManager.getInstance();
      const defaultModel = config.get<string>('model.default') || 'gpt-4';

      const payload: CopilotChatCompletionRequest = {
        messages: input.messages,
        model: input.model || defaultModel,
        temperature: input.temperature ?? 0.1,
        max_tokens: input.max_tokens ?? 1024,
        top_p: input.top_p,
        presence_penalty: input.presence_penalty,
        frequency_penalty: input.frequency_penalty,
        stream: false,
        user: input.user
      };

      const client = CopilotHttpClient.getInstance();
      const response = await client.postChatCompletion(token, payload);
      const text = await response.text();

      if (!response.ok) {
        let message = text || `GitHub Copilot API error (${response.status})`;
        try {
          const data = JSON.parse(text);
          message = data?.error?.message || message;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }

      let result: any;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error('Failed to parse Copilot response');
      }

      const content = result?.choices?.[0]?.message?.content || '';

      return {
        content: [
          {
            type: 'text',
            text: content
          }
        ],
        data: result
      };
    }
  );
}

async function resolveToken(): Promise<string | null> {
  const refreshed = await getValidToken();
  if (refreshed) {
    return refreshed;
  }

  const authInfo = loadAuthInfo();
  if (authInfo?.token) {
    return authInfo.token;
  }

  const token = loadToken();
  return token || null;
}
