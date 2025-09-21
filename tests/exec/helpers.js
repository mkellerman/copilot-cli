import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..');
const DIST_ENTRY = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const MOCK_SETUP = path.join(PROJECT_ROOT, 'tests', 'exec', 'mock-copilot.js');

export async function createTestContext(t, options = {}) {
  const tempRoot = path.join(os.tmpdir(), `copilot-cli-test-${randomUUID()}`);
  const homeDir = path.join(tempRoot, 'home');
  const workDir = path.join(tempRoot, 'work');
  const binDir = path.join(tempRoot, 'bin');
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  const configDir = path.join(homeDir, '.copilot-cli');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'token'), 'ghp_dummy_token', 'utf8');
  const authPayload = {
    token: 'ghp_dummy_token',
    provider: 'github',
    timestamp: Date.now()
  };
  await fs.writeFile(path.join(configDir, 'auth.json'), JSON.stringify(authPayload, null, 2));

  const profileId = 'test-profile';
  const profilesPayload = {
    [profileId]: {
      id: profileId,
      token: 'ghp_dummy_token',
      githubToken: 'gho_dummy',
      provider: 'github',
      timestamp: Date.now(),
      models: options.models ?? ['gpt-4', 'gpt-4o-mini'],
      user: {
        id: 1,
        login: 'test-user',
        name: 'Test User',
        email: 'test@example.com',
        avatar_url: 'https://example.com/avatar.png'
      }
    }
  };
  await fs.writeFile(path.join(configDir, 'profiles.json'), JSON.stringify(profilesPayload, null, 2));
  await fs.writeFile(path.join(configDir, 'active-profile'), profileId, 'utf8');

  const mockLog = path.join(tempRoot, 'mock-log.ndjson');

  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  return {
    tempRoot,
    homeDir,
    workDir,
    binDir,
    configDir,
    mockLog,
    models: options.models ?? ['gpt-4', 'gpt-4o-mini']
  };
}

export async function writeClaudeStub(context, contents) {
  const filePath = path.join(context.binDir, 'claude');
  await fs.writeFile(filePath, contents, { mode: 0o755 });
  return filePath;
}

export async function runCopilot(context, cliArgs, options = {}) {
  const env = {
    ...process.env,
    HOME: context.homeDir,
    PATH: `${context.binDir}:${process.env.PATH}`,
    COPILOT_CMD_TRIGGERS: '::',
    COPILOT_MOCK_MODELS: JSON.stringify(context.models),
    COPILOT_MOCK_LOG: context.mockLog,
    NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, `--require=${MOCK_SETUP}`),
    COPILOT_MOCK_RESPONSE_TEXT: options.mockResponseText ?? 'mocked-response'
  };

  if (options.env) {
    Object.assign(env, options.env);
  }

  const child = spawn(process.execPath, [DIST_ENTRY, ...cliArgs], {
    cwd: options.cwd ?? context.workDir,
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

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });

  return { stdout, stderr, exitCode };
}

function mergeNodeOptions(existing, injection) {
  if (!existing || existing.length === 0) {
    return injection;
  }
  if (existing.includes(injection)) {
    return existing;
  }
  return `${existing} ${injection}`.trim();
}

export async function readMockEvents(context) {
  try {
    const raw = await fs.readFile(context.mockLog, 'utf8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function readModelCatalog(context) {
  const file = path.join(context.configDir, 'model-catalog.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function findLatestLog(workDir) {
  const logsDir = path.join(workDir, 'logs');
  try {
    const files = await fs.readdir(logsDir);
    if (files.length === 0) return null;
    const sorted = files
      .map((name) => ({ name, full: path.join(logsDir, name) }))
      .sort((a, b) => b.name.localeCompare(a.name));
    return sorted[0].full;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function extractJsonPayload(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = lines[i];
    if (!candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  throw new Error('No JSON payload found in stdout');
}

export async function ensureActiveProfile(homeDir) {
  const profilesPath = path.join(homeDir, '.copilot-cli', 'profiles.json');
  const activePath = path.join(homeDir, '.copilot-cli', 'active-profile');
  try {
    const profilesRaw = await fs.readFile(profilesPath, 'utf8');
    const profiles = JSON.parse(profilesRaw);
    const active = (await fs.readFile(activePath, 'utf8')).trim();
    if (!active || !profiles[active]) {
      throw new Error('Active profile not found');
    }
    return { profiles, activeProfileId: active };
  } catch (error) {
    throw new Error('No Copilot profile configured. Run "copilot profile login" before executing live tests.');
  }
}
