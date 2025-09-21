import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { startApiServer } from '../../api/server.js';
import { ConfigManager } from '../../core/config-manager.js';
import { getValidToken } from '../../core/auth.js';
import { loadAuthInfo, loadToken } from '../../config/index.js';

export type ProviderKind = 'anthropic' | 'openai';

export interface CliAdapterOptions {
  program: string; // external CLI executable name, e.g. 'claude', 'happy'
  provider: ProviderKind; // which env contract to expose
  args: string[]; // passthrough args for the CLI
}

export async function runCliAdapter(options: CliAdapterOptions): Promise<void> {
  const { program, provider, args } = options;

  const config = ConfigManager.getInstance();
  const debug = config.get<boolean>('debug') ?? false;

  if (debug) {
    process.env.DEBUG = 'true';
  }

  // Allow --verbose passed either globally or after the external command to set COPILOT_VERBOSE
  // 1) global (from yargs): process.env.COPILOT_VERBOSE may already be set by CLI
  // 2) local to external command: extract from args and set env
  const { prunedArgs, verboseLevel } = extractVerbose(args);
  if (typeof verboseLevel === 'number') {
    process.env.COPILOT_VERBOSE = String(verboseLevel);
  } else {
    // Try to detect from full argv if not provided locally
    const fromArgv = extractVerbose(process.argv.slice(2));
    if (typeof fromArgv.verboseLevel === 'number') {
      process.env.COPILOT_VERBOSE = String(fromArgv.verboseLevel);
    }
  }

  const token = await resolveToken();
  if (!token) {
    // Allow running without a token so internal in-chat commands (e.g., --help, --models)
    // can be handled locally by the proxy server.
    if (!debug) {
      // keep output minimal unless debug is enabled
      console.log('No token found; running with limited features (commands only).');
    } else {
      console.log('[debug] No token found; continuing for local commands.');
    }
  }

  const host = '127.0.0.1';
  const requestedPort = 0; // pick an ephemeral free port
  // If verbose logging is enabled and running silently, write logs to file
  const verbose = parseInt(process.env.COPILOT_VERBOSE || '', 10);
  let logPath: string | undefined;
  if (Number.isFinite(verbose) && verbose > 0) {
    logPath = createLogFilePath();
    process.env.COPILOT_LOG_FILE = logPath;
  }
  const server = startApiServer(requestedPort, token || undefined, host, { silent: true });
  let exitCode: number | null = null;

  try {
    await awaitServerReady(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine API server address');
    }
    const actualPort = (address as AddressInfo).port;
    const apiUrl = `http://${host}:${actualPort}`;

    console.log(`Using temporary proxy at ${apiUrl}`);
    if (logPath) {
      const relative = toRelativePath(logPath);
      console.log(`Verbose logs : ${relative}`);
    }

    const env = buildProviderEnv(provider, apiUrl, token);

    const child = spawn(program, prunedArgs, {
      stdio: 'inherit',
      env
    });

    const handleSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    exitCode = await new Promise<number>((resolve, reject) => {
      child.on('exit', (code, signal) => {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        if (signal) {
          resolve(signalExitCode(signal));
        } else {
          resolve(code ?? 0);
        }
      });
      child.on('error', (error) => {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        reject(error);
      });
    });
  } finally {
    await closeServer(server).catch(() => {
      /* ignore close errors */
    });
  }

  if (exitCode !== null && exitCode !== 0) {
    process.exit(exitCode);
  }
}

function buildProviderEnv(provider: ProviderKind, baseUrl: string, token: string | null): NodeJS.ProcessEnv {
  const common = { ...process.env } as NodeJS.ProcessEnv;
  const placeholderOpenAI = 'sk-local-dummy';
  const placeholderAnthropic = 'anthropic-local-dummy';
  switch (provider) {
    case 'anthropic':
      return {
        ...common,
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_API_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: token ?? placeholderAnthropic,
        ANTHROPIC_API_KEY: token ?? placeholderAnthropic
      };
    case 'openai':
      return {
        ...common,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_BASE: baseUrl,
        OPENAI_API_KEY: token ?? placeholderOpenAI
      };
    default:
      return common;
  }
}

function extractVerbose(argv: string[]): { prunedArgs: string[]; verboseLevel?: number } {
  const out: string[] = [];
  let level: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verbose') {
      const next = argv[i + 1];
      const n = next !== undefined ? parseInt(next, 10) : NaN;
      if (Number.isFinite(n)) {
        level = clampVerbose(n);
        i++; // consume next
      } else {
        level = 1;
      }
      continue;
    }
    if (arg.startsWith('--verbose=')) {
      const val = arg.split('=')[1];
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) {
        level = clampVerbose(n);
      }
      continue;
    }
    out.push(arg);
  }
  return { prunedArgs: out, verboseLevel: level };
}

function clampVerbose(n: number): number {
  n = Math.floor(n);
  if (n < 0) return 0;
  if (n > 3) return 3;
  return n;
}

function createLogFilePath(): string {
  const ts = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const dir = 'logs';
  const file = `copilot-cli-api.${stamp}.log`;
  const p = path.join(process.cwd(), dir, file);
  // Ensure directory exists now so logger can write immediately
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
  } catch {
    // ignore
  }
  return p;
}

function toRelativePath(absolutePath: string): string {
  try {
    const rel = path.relative(process.cwd(), absolutePath);
    return rel.startsWith('..') ? absolutePath : `./${rel}`;
  } catch {
    return absolutePath;
  }
}

async function resolveToken(): Promise<string | null> {
  const refreshed = await getValidToken();
  if (refreshed) {
    return refreshed;
  }

  const info = loadAuthInfo();
  if (info?.token) {
    return info.token;
  }

  const legacy = loadToken();
  return legacy || null;
}

async function awaitServerReady(server: Server): Promise<void> {
  await Promise.race([
    once(server, 'listening'),
    once(server, 'error').then(([error]) => {
      throw error;
    })
  ]);
}

async function closeServer(server: Server): Promise<void> {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function signalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case 'SIGINT':
      return 130;
    case 'SIGTERM':
      return 143;
    default:
      return 1;
  }
}
