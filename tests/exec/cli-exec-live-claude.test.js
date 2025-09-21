import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureActiveProfile } from './helpers.js';

if (!process.env.RUN_LIVE_EXEC_CLAUDE) {
  test('skipped live claude exec suite (set RUN_LIVE_EXEC_CLAUDE=1 to enable)', () => {});
} else {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error('HOME is not defined; cannot locate Copilot profiles');
  }

  test('claude live exec performs chat completion via copilot proxy', async (t) => {
    await ensureActiveProfile(homeDir);

    const prompts = [
      "Hi! I'm running a live test.",
      'Describe the Copilot CLI exec workflow briefly.'
    ];

    for (const prompt of prompts) {
      const { stdout, stderr, exitCode, logTail } = await runLiveExec(['claude', '-p', prompt]);
      assert.strictEqual(
        exitCode,
        0,
        `exec failed (exit ${exitCode}).\nstdout:\n${stdout || '(empty)'}\n\nstderr:\n${stderr || '(empty)'}\n\nlog tail:\n${logTail || '(log empty)'}`
      );
      const text = stdout.trim();
      assert.ok(text.length > 0, 'expected copilot exec to return content');
      await t.test(`prompt -> ${prompt.slice(0, 30)}`, () => {});
    }
  });
}

async function runLiveExec(args) {
  const { spawn } = await import('node:child_process');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-live-logs-'));
  const logFile = path.join(tempDir, `exec-${randomUUID()}.log`);
  const env = { ...process.env, COPILOT_VERBOSE: '3', COPILOT_LOG_FILE: logFile };

  const child = spawn(process.execPath, [path.resolve('dist/cli/index.js'), 'exec', ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  let logTail = '';
  try {
    const logText = await fs.readFile(logFile, 'utf8');
    const lines = logText.trim().split(/\r?\n/);
    logTail = lines.slice(-60).join('\n');
  } catch (error) {
    logTail = `(unable to read log: ${error?.message || error})`;
  }

  return { stdout, stderr, exitCode, logTail };
}
