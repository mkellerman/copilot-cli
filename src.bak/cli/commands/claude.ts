import { runCliAdapter } from '../external/adapter.js';

interface ClaudeOptions {}

export async function run(_options: ClaudeOptions, claudeArgs: string[]): Promise<void> {
  await runCliAdapter({ program: 'claude', provider: 'anthropic', args: claudeArgs });
}
