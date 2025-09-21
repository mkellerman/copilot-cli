import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { startApiServer } from '../../api/server.js';
import { ConfigManager } from '../../core/config-manager.js';
import { getValidToken } from '../../core/auth.js';
import { loadAuthInfo, loadToken } from '../../config/index.js';

export type ExecProvider = 'anthropic' | 'openai';

export interface ExecAdapterOptions {
  command: string;
  args: string[];
  provider: ExecProvider;
  globalVerbose?: number;
}

export async function runExecAdapter(options: ExecAdapterOptions): Promise<void> {
  const { command, args, provider, globalVerbose } = options;

  const config = ConfigManager.getInstance();
  const debug = config.get<boolean>('debug') ?? false;

  const { prunedArgs, verboseLevel } = extractVerbose(args);
  const effectiveVerbose = normalizeVerbose(globalVerbose ?? verboseLevel);
  if (typeof effectiveVerbose === 'number') {
    process.env.COPILOT_VERBOSE = String(effectiveVerbose);
  }

  if (debug) {
    process.env.DEBUG = 'true';
  }

  let logPath: string | undefined;
  if (typeof effectiveVerbose === 'number' && effectiveVerbose > 0) {
    logPath = createLogFilePath();
    process.env.COPILOT_LOG_FILE = logPath;
  }

  const token = await resolveToken();

  const host = '127.0.0.1';
  const requestedPort = 0;
  const server = startApiServer(requestedPort, token ?? undefined, host, { silent: true });
  let exitCode: number | null = null;

  try {
    await awaitServerReady(server);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine API server address');
    }

    const actualPort = (address as AddressInfo).port;
    const apiUrl = `http://${host}:${actualPort}`;

    announceProxy(apiUrl, logPath, token);

    const childEnv = buildProviderEnv(provider, apiUrl, token);

    const child = spawn(command, prunedArgs, {
      stdio: 'inherit',
      env: childEnv
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

function announceProxy(apiUrl: string, logPath?: string, token?: string | null) {
  const verbose = parseInt(process.env.COPILOT_VERBOSE || '', 10);
  const silent = Number.isFinite(verbose) ? verbose < 1 : false;
  if (!token) {
    if (!silent) {
      console.log('No Copilot token found; running with limited features (local commands only).');
    }
  }
  console.log(`Using temporary proxy at ${apiUrl}`);
  if (logPath) {
    console.log(`Verbose logs : ${toRelativePath(logPath)}`);
  }
}

function buildProviderEnv(provider: ExecProvider, baseUrl: string, token: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  const placeholderOpenAI = 'sk-local-dummy';
  const placeholderAnthropic = 'anthropic-local-dummy';

  switch (provider) {
    case 'anthropic':
      return {
        ...env,
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_API_URL: baseUrl,
        // ANTHROPIC_API_KEY: token ?? placeholderAnthropic,
        ANTHROPIC_AUTH_TOKEN: token ?? placeholderAnthropic
      };
    case 'openai':
      return {
        ...env,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_BASE: baseUrl,
        OPENAI_API_KEY: token ?? placeholderOpenAI
      };
    default:
      return env;
  }
}

function extractVerbose(argv: string[]): { prunedArgs: string[]; verboseLevel?: number } {
  const out: string[] = [];
  let level: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--verbose') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        const parsed = parseInt(next, 10);
        if (Number.isFinite(parsed)) {
          level = clampVerbose(parsed);
          i++;
          continue;
        }
      }
      level = 1;
      continue;
    }

    if (arg.startsWith('--verbose=')) {
      const [, raw] = arg.split('=');
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        level = clampVerbose(parsed);
        continue;
      }
    }

    out.push(arg);
  }

  return { prunedArgs: out, verboseLevel: level };
}

function normalizeVerbose(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return clampVerbose(Math.floor(value));
}

function clampVerbose(value: number): number {
  if (value < 0) return 0;
  if (value > 3) return 3;
  return value;
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
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
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

function createLogFilePath(): string {
  const timestamp = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}`;
  const logsDir = path.join(process.cwd(), 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // ignore errors creating logs directory
  }
  return path.join(logsDir, `copilot.exec.${stamp}.log`);
}

function toRelativePath(absolutePath: string): string {
  try {
    const relative = path.relative(process.cwd(), absolutePath);
    if (relative.startsWith('..')) {
      return absolutePath;
    }
    return `./${relative}`;
  } catch {
    return absolutePath;
  }
}
