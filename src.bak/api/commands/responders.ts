export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: 'end_turn' | 'max_tokens' | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export function buildAnthropicCommandResponse(text: string): AnthropicMessageResponse {
  return {
    id: `cmd_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: 'copilot-cli',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn'
  };
}

export function buildOpenAICommandResponse(text: string) {
  const created = Math.floor(Date.now() / 1000);
  return {
    id: `cmd_${Date.now()}`,
    object: 'chat.completion',
    created,
    model: 'copilot-cli',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  } as const;
}

