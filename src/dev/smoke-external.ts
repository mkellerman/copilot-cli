// Simple smoke test for the external CLI adapter.
// It launches the adapter with provider 'anthropic' and runs a tiny Node child
// that prints the Anthropic env variables made available by the adapter.

import { runExecAdapter } from '../cli/adapters/exec-adapter.js';

async function main() {
  console.log('[smoke-external] Starting Anthropic adapter smoke test...');
  try {
    // The child process will inherit env set by the adapter; we just print them.
    const code = `
      const out = {
        url: process.env.ANTHROPIC_BASE_URL || null,
        tokenPresent: Boolean(process.env.ANTHROPIC_AUTH_TOKEN)
      };
      console.log('[smoke-external-child]', JSON.stringify(out));
    `;

    await runExecAdapter({ command: 'node', provider: 'anthropic', args: ['-e', code] });
    console.log('[smoke-external] Completed. If you saw [smoke-external-child] with url and tokenPresent=true, env wiring works.');
  } catch (err: any) {
    const msg = String(err?.message || err || 'unknown error');
    if (/No authentication token found/i.test(msg)) {
      console.error('[smoke-external] Skipping: no token available. Run `copilot profile login` first and retry.');
      process.exitCode = 0; // Not a failure in CI if auth not configured
      return;
    }
    console.error('[smoke-external] Failed:', msg);
    process.exitCode = 1;
  }
}

main();
