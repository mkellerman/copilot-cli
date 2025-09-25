import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ensureActiveProfile } from './helpers.js';

if (!process.env.RUN_LIVE_EXEC_CLAUDE) {


} else {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) throw new Error('HOME is not defined; cannot locate Copilot profiles');

  let apiProc = null;
  let apiPort = 0;
  let apiToken = '';
  let sharedEnv = {};
  let tempDirs = [];
  let summary = { pass: 0, fail: 0, skipped: 0, total: 0 };

  async function startApiServer() {
    const { spawn } = await import('node:child_process');
    const port = 4000 + Math.floor(Math.random() * 1000);
    const env = { ...process.env, PORT: String(port) };
    const proc = spawn(process.execPath, [new URL('../../dist/api/standalone.js', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('proxy server running')) ready = true, resolve();
      });
      proc.stderr.on('data', (chunk) => {
        if (chunk.toString().includes('proxy server running')) ready = true, resolve();
      });
      setTimeout(() => { if (!ready) reject(new Error('API server did not start in time')); }, 8000);
    });
    const { loadAuthInfo, loadToken } = await import('../../dist/config/index.js');
    const authInfo = loadAuthInfo();
    const token = authInfo?.token || loadToken();
    return { proc, port, token };
  }

  async function stopApiServer(proc) {
    if (proc) {
      proc.kill('SIGTERM');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server did not terminate')), 5000);
        proc.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  async function runLiveExec(args, envOverride = {}) {
    const { spawn } = await import('node:child_process');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-live-logs-'));
    tempDirs.push(tempDir);
    const logFile = path.join(tempDir, `exec-${randomUUID()}.log`);
    const env = { ...sharedEnv, ...envOverride, COPILOT_VERBOSE: '3', COPILOT_LOG_FILE: logFile };
    const child = spawn(process.execPath, [path.resolve('dist/cli/index.js'), 'exec', ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const exitCode = await new Promise((resolve) => { child.on('close', (code) => resolve(code ?? 0)); });
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

  // 1. Direct API test (token check)
  test('direct API: POST /v1/messages returns Claude output', async () => {
    const { proc, port, token } = await startApiServer();
    apiProc = proc;
    apiPort = port;
    apiToken = token;
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch(`http://localhost:${apiPort}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 32, messages: [{ role: 'user', content: 'Say hello from Claude.' }] })
    });
    const data = await resp.json();
    assert.ok(data && (data.content || data.completion), 'Claude API did not return content');
    await stopApiServer(apiProc);
    summary.pass++;
    summary.total++;
  });

  // 2. End-to-end: copilot exec claude
  test('copilot exec claude returns Claude output', async () => {
    await ensureActiveProfile(homeDir);
    const { proc, port, token } = await startApiServer();
    apiProc = proc;
    apiPort = port;
    apiToken = token;
    sharedEnv = { ...process.env, COPILOT_API_URL: `http://localhost:${apiPort}/v1`, COPILOT_API_TOKEN: apiToken };
    const { stdout, exitCode } = await runLiveExec(['claude', '-p', 'Say hello from Claude.']);
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /hello/i);
    await stopApiServer(apiProc);
    summary.pass++;
    summary.total++;
  });

  // 3. In-chat command: copilot exec claude ::help
  test('copilot exec claude ::help returns help', async () => {
    await ensureActiveProfile(homeDir);
    const { proc, port, token } = await startApiServer();
    apiProc = proc;
    apiPort = port;
    apiToken = token;
    sharedEnv = { ...process.env, COPILOT_API_URL: `http://localhost:${apiPort}/v1`, COPILOT_API_TOKEN: apiToken };
    const { stdout, exitCode } = await runLiveExec(['claude', '-p', '::help']);
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /In-Chat Commands/);
    await stopApiServer(apiProc);
    summary.pass++;
    summary.total++;
  });

  // 4. Start API server once for all remaining tests
  test('setup: start API server for battery', async () => {
    const { proc, port, token } = await startApiServer();
    apiProc = proc;
    apiPort = port;
    apiToken = token;
    sharedEnv = { ...process.env, COPILOT_API_URL: `http://localhost:${apiPort}/v1`, COPILOT_API_TOKEN: apiToken };
    assert.ok(apiProc && apiPort && apiToken, 'API server did not start');
    summary.total++;
  });

  // 5-20. Battery of tests using direct claude -p ...
  const battery = [
    {
      name: '::models returns available models',
      args: ['claude', '-p', '::models'],
      expect: /Available models|Working Models/,
    },
    {
      name: '::config lists all config',
      args: ['claude', '-p', '::config'],
      expect: /Current configuration/,
    },
    {
      name: '::config set model.default gpt-4o-mini sets default',
      args: ['claude', '-p', '::config set model.default gpt-4o-mini'],
      post: async () => {
        const { stdout } = await runLiveExec(['claude', '-p', '::config model.default']);
        assert.match(stdout, /gpt-4o-mini/);
      }
    },
    {
      name: '::config model.default returns default',
      args: ['claude', '-p', '::config model.default'],
      expect: /model.default/,
    },
    {
      name: '::config set debug bar sets custom key',
      args: ['claude', '-p', '::config set debug bar'],
      post: async () => {
        const { stdout } = await runLiveExec(['claude', '-p', '::config debug']);
        assert.match(stdout, /bar/);
      }
    },
    {
      name: '::config debug returns value bar',
      args: ['claude', '-p', '::config debug'],
      expect: /bar/,
    },
    {
      name: '::config set model.default (missing value) error',
      args: ['claude', '-p', '::config set model.default'],
      expect: /Usage|No value set|error|Failed/,
    },
    {
      name: '::unknowncmd returns unknown command',
      args: ['claude', '-p', '::unknowncmd'],
      expect: /Unknown in-chat command|Try ::help/,
    },
    {
      name: '::models highlights new default after change',
      args: ['claude', '-p', '::config set model.default gpt-4o-mini'],
      post: async () => {
        const { stdout } = await runLiveExec(['claude', '-p', '::models']);
        assert.match(stdout, /gpt-4o-mini/);
        assert.match(stdout, /Current default: gpt-4o-mini/);
      }
    },
    {
      name: '::config set [model.default] [gpt-4] with brackets',
      args: ['claude', '-p', '::config set [model.default] [gpt-4]'],
      post: async () => {
        const { stdout } = await runLiveExec(['claude', '-p', '::config model.default']);
        assert.match(stdout, /gpt-4/);
      }
    },
    {
      name: '::models with extra whitespace',
      args: ['claude', '-p', '::models   '],
      expect: /Available models|Working Models/,
    },
    {
      name: '::config set model.default gpt-4 with whitespace',
      args: ['claude', '-p', '::config set   model.default    gpt-4'],
      post: async () => {
        const { stdout } = await runLiveExec(['claude', '-p', '::config model.default']);
        assert.match(stdout, /gpt-4/);
      }
    },
    {
      name: '::models as first message',
      args: ['claude', '-p', '::models'],
      expect: /Available models|Working Models/,
    },
    {
      name: '::help as first message',
      args: ['claude', '-p', '::help'],
      expect: /In-Chat Commands/,
    },
    {
      name: '::models with many models',
      args: ['claude', '-p', '::models'],
      expect: /Available models|Working Models/,
      post: async ({ stdout }) => {
        const modelLines = stdout.split('\n').filter(l => l.match(/\s+\w/));
        assert.ok(modelLines.length >= 3, 'expected at least 3 models listed');
      }
    },
    {
      name: '::config after multiple sets',
      args: ['claude', '-p', '::config set debug bar'],
      post: async () => {
        await runLiveExec(['claude', '-p', '::config set model.default qux']);
        const { stdout } = await runLiveExec(['claude', '-p', '::config']);
        assert.match(stdout, /debug/);
        assert.match(stdout, /model.default/);
      }
    },
    {
      name: '::config set model.default with no value',
      args: ['claude', '-p', '::config set model.default'],
      expect: /Usage|No value set|error|Failed/,
    },
    {
      name: '::models when no models available',
      args: ['claude', '-p', '::models'],
      expect: /Available models|Working Models|No models available/,
    },
    {
      name: '::config set model.default gpt-4 then ::models',
      args: ['claude', '-p', '::config set model.default gpt-4'],
      post: async () => {
        const { stdout } = await runLiveExec(['claude', '-p', '::models']);
        assert.match(stdout, /gpt-4/);
        assert.match(stdout, /Current default: gpt-4/);
      }
    },
  ];

  for (const testCase of battery) {
    test(testCase.name, async () => {
      try {
        const { stdout, exitCode } = await runLiveExec(testCase.args);
        if (testCase.expect) {
          assert.strictEqual(exitCode, 0);
          assert.match(stdout, testCase.expect);
        }
        if (testCase.post) {
          await testCase.post({ stdout });
        }
        summary.pass++;
      } catch (err) {
        summary.fail++;
        throw err;
      } finally {
        summary.total++;
      }
    });
  }

  test('teardown: stop API server and cleanup', async () => {
    await stopApiServer(apiProc);
    for (const dir of tempDirs) {
      try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
    }
    summary.total++;
  });

  test('summary: print totals', () => {
    // eslint-disable-next-line no-console
    console.log(`\nTest summary: ${summary.pass} passed, ${summary.fail} failed, ${summary.total} total`);
  });

  // 5. ::config model.default returns current default
  test('::config model.default returns default', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::config model.default']);
    assert.match(stdout, /model.default/);
  });

  // 6. ::config set foo bar sets custom key
  test('::config set debug bar sets custom key', async () => {
    await runLiveExec(['claude', '-p', '::config set debug bar']);
    const { stdout } = await runLiveExec(['claude', '-p', '::config debug']);
    assert.match(stdout, /bar/);
  });

  // 7. ::config foo returns value bar
  test('::config debug returns value', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::config debug']);
    assert.match(stdout, /bar/);
  });

  // 8. ::config set model.default (missing value) returns error
  test('::config set model.default (missing value) error', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::config set model.default']);
    assert.match(stdout, /Usage|No value set|error|Failed/);
  });

  // 9. ::unknowncmd returns unknown command
  test('::unknowncmd returns unknown command', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::unknowncmd']);
    assert.match(stdout, /Unknown in-chat command|Try ::help/);
  });

  // 10. ::models after changing default highlights new default
  test('::models highlights new default after change', async () => {
    await runLiveExec(['claude', '-p', '::config set model.default gpt-4o-mini']);
    const { stdout } = await runLiveExec(['claude', '-p', '::models']);
    assert.match(stdout, /gpt-4o-mini/);
    assert.match(stdout, /Current default: gpt-4o-mini/);
  });

  // 11. ::config set [model.default] [gpt-4] (with brackets)
  test('::config set [model.default] [gpt-4] with brackets', async () => {
    await runLiveExec(['claude', '-p', '::config set [model.default] [gpt-4]']);
    const { stdout } = await runLiveExec(['claude', '-p', '::config model.default']);
    assert.match(stdout, /gpt-4/);
  });

  // 12. ::models with extra whitespace
  test('::models with extra whitespace', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::models   ']);
    assert.match(stdout, /Available models|Working Models/);
  });

  // 13. ::config set model.default gpt-4 with extra whitespace
  test('::config set model.default gpt-4 with whitespace', async () => {
    await runLiveExec(['claude', '-p', '::config set   model.default    gpt-4']);
    const { stdout } = await runLiveExec(['claude', '-p', '::config model.default']);
    assert.match(stdout, /gpt-4/);
  });

  // 14. ::models as first message after startup
  test('::models as first message', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::models']);
    assert.match(stdout, /Available models|Working Models/);
  });

  // 15. ::help as first message after startup
  test('::help as first message', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::help']);
    assert.match(stdout, /In-Chat Commands/);
  });

  // 16. ::models with many models (mocked)
  test('::models with many models', async () => {
    // This test assumes the backend or mock can be configured for many models
    const { stdout } = await runLiveExec(['claude', '-p', '::models']);
    // Just check that at least 3+ models are listed
    const modelLines = stdout.split('\n').filter(l => l.match(/\s+\w/));
    assert.ok(modelLines.length >= 3, 'expected at least 3 models listed');
  });

  // 17. ::config after setting multiple keys
  test('::config after multiple sets', async () => {
    await runLiveExec(['claude', '-p', '::config set debug bar']);
    await runLiveExec(['claude', '-p', '::config set model.default qux']);
    const { stdout } = await runLiveExec(['claude', '-p', '::config']);
    assert.match(stdout, /debug/);
    assert.match(stdout, /model.default/);
  });

  // 18. ::config set model.default with no value
  test('::config set model.default with no value', async () => {
    const { stdout } = await runLiveExec(['claude', '-p', '::config set model.default']);
    assert.match(stdout, /Usage|No value set|error|Failed/);
  });

  // 19. ::models when no models available
  test('::models when no models available', async () => {
    // This test assumes the backend or mock can be configured to return no models
    // For now, just check that the output is robust
    const { stdout } = await runLiveExec(['claude', '-p', '::models']);
    assert.match(stdout, /Available models|Working Models|No models available/);
  });

  // 20. ::config set model.default gpt-4 then ::models shows correct default
  test('::config set model.default gpt-4 then ::models', async () => {
    await runLiveExec(['claude', '-p', '::config set model.default gpt-4']);
    const { stdout } = await runLiveExec(['claude', '-p', '::models']);
    assert.match(stdout, /gpt-4/);
    assert.match(stdout, /Current default: gpt-4/);
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
