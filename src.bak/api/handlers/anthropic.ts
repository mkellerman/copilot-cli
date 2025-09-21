import type { CopilotChatCompletionRequest } from '../../core/copilot-client.js';
import { parseInChatCommand } from '../commands/index.js';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

export const MODEL_MAP: Record<string, string> = {
  'claude-3-opus-20240229': 'gpt-5',
  'claude-3-sonnet-20240229': 'gpt-5',
  'claude-3-haiku-20240307': 'gpt-5-mini',
  'claude-3-5-sonnet-20240620': 'gpt-5',
  'claude-3-5-haiku-20241022': 'gpt-5-mini'
};

function mapAnthropicModel(
  model: string | undefined,
  fallback: string,
  overrides?: Map<string, string>
): string {
  if (!model) return fallback || 'gpt-5';
  const normalized = model.trim();
  if (overrides && overrides.has(normalized)) {
    return overrides.get(normalized) as string;
  }
  if (MODEL_MAP[normalized]) {
    return MODEL_MAP[normalized];
  }
  if (normalized.startsWith('claude-3-5')) {
    return MODEL_MAP['claude-3-5-sonnet-20240620'];
  }
  if (normalized.startsWith('claude-3-haiku')) {
    return MODEL_MAP['claude-3-haiku-20240307'];
  }
  if (normalized.startsWith('claude-3')) {
    return MODEL_MAP['claude-3-opus-20240229'];
  }
  if (normalized.startsWith('claude-2')) {
    return MODEL_MAP['claude-3-opus-20240229'];
  }
  return fallback || 'gpt-5';
}

export interface AnthropicMessageRequest {
  model?: string;
  system?: string;
  messages?: AnthropicMessage[];
  prompt?: string;
  input?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

export interface AnthropicConversionResult {
  request: CopilotChatCompletionRequest;
  requestedModel: string;
}

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

export function toChatCompletionRequest(
  body: AnthropicMessageRequest,
  defaultModel: string,
  overrides?: Map<string, string>
): AnthropicConversionResult {
  const messages: CopilotChatCompletionRequest['messages'] = [];

  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }

  const userMessages = getUserMessages(body);
  if (userMessages.length === 0) {
    throw new Error('messages array must contain at least one message');
  }

  for (const message of userMessages) {
    const role = message.role || 'user';
    const content = normalizeContent(message.content);
    messages.push({ role, content });
  }

  const requestedModel = body.model || defaultModel;
  const mappedModel = mapAnthropicModel(requestedModel, defaultModel, overrides);

  return {
    request: {
      model: mappedModel,
      messages,
      max_tokens: body.max_tokens ?? 1024,
      temperature: body.temperature ?? 0.1,
      top_p: body.top_p,
      stream: !!body.stream,
      stop: body.stop_sequences
    },
    requestedModel
  };
}

export function toAnthropicResponse(
  copilotResponse: any,
  model: string
): AnthropicMessageResponse {
  const content = extractAssistantContent(copilotResponse);
  const stopReason = determineStopReason(copilotResponse);
  const usage = copilotResponse?.usage;

  return {
    id: copilotResponse?.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: content }],
    stop_reason: stopReason,
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens
        }
      : undefined
  };
}

function getUserMessages(body: AnthropicMessageRequest): AnthropicMessage[] {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages;
  }
  const promptInput = typeof body.prompt === 'string' ? body.prompt : (typeof body.input === 'string' ? body.input : undefined);
  if (!promptInput) {
    return [];
  }
  return [{ role: 'user', content: promptInput }];
}

function normalizeContent(content: AnthropicMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && typeof block.text === 'string') {
          return block.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractAssistantContent(response: any): string {
  const choices = response?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }
  const message = choices[0]?.message;
  if (!message) {
    return choices[0]?.content ?? '';
  }
  return message.content ?? '';
}

function determineStopReason(response: any): 'end_turn' | 'max_tokens' | null {
  const finishReason = response?.choices?.[0]?.finish_reason;
  if (!finishReason) return null;
  if (finishReason === 'length') return 'max_tokens';
  return 'end_turn';
}

export function detectCommandInRequest(body: AnthropicMessageRequest): { command: string; args: string[] } | null {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const last = body.messages[body.messages.length - 1];
    const parsed = parseInChatCommand(normalizeContent(last.content));
    if (parsed) return parsed;
  }
  if (typeof body.prompt === 'string') {
    const parsed = parseInChatCommand(body.prompt);
    if (parsed) return parsed;
  }
  if (typeof body.input === 'string') {
    const parsed = parseInChatCommand(body.input);
    if (parsed) return parsed;
  }
  return null;
}

export function buildCommandResponse(
  command: string,
  args: string[],
  overrides: Map<string, string>,
  defaults: Record<string, string>
): AnthropicMessageResponse {
  const lines: string[] = [];
  const combined = new Map<string, string>(Object.entries(defaults));
  overrides.forEach((value, key) => combined.set(key, value));
  switch (command) {
    case '--help':
      lines.push('In-chat commands:');
      lines.push('--help                 show this help');
      lines.push('--models               list mapped Anthropic -> Copilot models');
      lines.push('--set-model <anthropic> <copilot>   override mapping for this session');
      lines.push('--reset-models         restore default session mappings');
      break;
    case '--models':
      lines.push('Mapped models:');
      if (combined.size === 0) {
        lines.push('(no mappings configured)');
      } else {
        for (const [anthropicModel, copilotModel] of combined.entries()) {
          lines.push(`- ${anthropicModel} → ${copilotModel}`);
        }
      }
      break;
    case '--set-model': {
      const message = applySetModelCommand(args, overrides);
      lines.push(message);
      break;
    }
    case '--reset-models': {
      const message = applyResetModelsCommand(overrides, defaults);
      lines.push(message);
      break;
    }
    default:
      lines.push(`Unknown in-chat command: ${command}`);
      lines.push('Try --help for available commands.');
      break;
  }

  return {
    id: `cmd_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: 'copilot-cli',
    content: [{ type: 'text', text: lines.join('\n') }],
    stop_reason: 'end_turn'
  };
}

function applySetModelCommand(args: string[], mapping: Map<string, string>): string {
  if (args.length < 2) {
    return 'Usage: --set-model <anthropic_model> <copilot_model>';
  }
  const anthropic = args[0].trim();
  const copilot = args[1].trim();
  mapping.set(anthropic, copilot);
  return `Mapped ${anthropic} → ${copilot}`;
}

function applyResetModelsCommand(mapping: Map<string, string>, _defaults: Record<string, string>): string {
  mapping.clear();
  return 'Mappings reset to defaults';
}
