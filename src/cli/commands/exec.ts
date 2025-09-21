import { runExecAdapter, type ExecProvider } from '../adapters/exec-adapter.js';

const ANTHROPIC_HINTS = new Set(['claude', 'happy', 'anthropic', 'haiku', 'sonnet']);

export interface ExecCommandOptions {
  command: string;
  args: string[];
  provider?: ExecProvider;
  globalVerbose?: number;
}

export async function runExecCommand(options: ExecCommandOptions): Promise<void> {
  const { command, args, provider, globalVerbose } = options;
  if (!command) {
    throw new Error('No command specified. Usage: copilot exec <command> [args...]');
  }

  const resolvedProvider = provider ?? detectProvider(command);
  await runExecAdapter({ command, args, provider: resolvedProvider, globalVerbose });
}

function detectProvider(command: string): ExecProvider {
  const binary = command.split(/[\\/]/).pop()?.toLowerCase() ?? command.toLowerCase();
  if (ANTHROPIC_HINTS.has(binary) || binary.startsWith('claude')) {
    return 'anthropic';
  }
  return 'openai';
}
