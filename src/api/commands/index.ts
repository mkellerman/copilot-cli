export interface InChatCommand {
  command: string;
  args: string[];
}

const DEFAULT_TRIGGERS = ['::'];

export function getCommandTriggers(): string[] {
  const raw = process.env.COPILOT_CMD_TRIGGERS;
  if (!raw) return DEFAULT_TRIGGERS;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  // Ensure unique, keep order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result.length > 0 ? result : DEFAULT_TRIGGERS;
}

export function parseInChatCommand(content: string): InChatCommand | null {
  if (!content) return null;
  const trimmed = content.trim();
  const triggers = getCommandTriggers();
  let matched: string | null = null;
  for (const t of triggers) {
    if (trimmed.startsWith(t)) {
      matched = t;
      break;
    }
  }
  if (!matched) return null;
  const withoutPrefix = trimmed.slice(matched.length).trim();
  if (!withoutPrefix) return null;
  // Accept both [arg] and arg, normalize by stripping brackets
  const parts = withoutPrefix.split(/\s+/).map(arg => {
    if (arg.startsWith('[') && arg.endsWith(']')) {
      return arg.slice(1, -1);
    }
    return arg;
  });
  const [command, ...args] = parts;
  if (!command) return null;
  return { command, args };
}
