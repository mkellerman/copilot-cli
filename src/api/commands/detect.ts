import { parseInChatCommand, type InChatCommand } from './index.js';

function last<T>(arr: T[] | undefined | null): T | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr[arr.length - 1];
}

export function detectCommandInBody(body: any): InChatCommand | null {
  if (!body || typeof body !== 'object') return null;

  // Try OpenAI-style chat.completions body: { messages: [{ role, content }] }
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const lastMsg = last(body.messages);
    const msgContent = (lastMsg as any)?.content;
    // Prefer Anthropic-style content blocks: scan from end for a standalone command
    if (Array.isArray(msgContent)) {
      for (let i = msgContent.length - 1; i >= 0; i--) {
        const block = msgContent[i];
        const text = typeof block?.text === 'string' ? block.text.trim() : '';
        if (!text) continue;
        const parsed = parseInChatCommand(text);
        if (parsed) return parsed;
      }
    }
    // Fallback: string content or flattened text
    const content = typeof msgContent === 'string'
      ? msgContent
      : Array.isArray(msgContent)
        ? msgContent.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
        : '';
    const parsed = parseInChatCommand(content);
    if (parsed) return parsed;
  }

  // Anthropic compatibility: { prompt: string } or { input: string }
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
