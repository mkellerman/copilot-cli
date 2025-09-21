import { runCliAdapter } from '../external/adapter.js';

interface HappyOptions {}

export async function run(_options: HappyOptions, happyArgs: string[]): Promise<void> {
  // 'happy' is assumed to be an Anthropic-compatible CLI like 'claude'
  await runCliAdapter({ program: 'happy', provider: 'anthropic', args: happyArgs });
}
