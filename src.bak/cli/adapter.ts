import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { startApiServer } from '../api/server.js';
import { ConfigManager } from '../core/config-manager.js';
import { getValidToken } from '../core/auth.js';
import { loadAuthInfo, loadToken } from '../config/index.js';

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

  const token = await resolveToken();
  if (!token) {
    throw new Error('No authentication token found. Run: copilot-cli auth login');
  }

  const host = '127.0.0.1';
  const requestedPort = 0; // pick an ephemeral free port
  const server = startApiServer(requestedPort, token, host, { silent: true });
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

    const env = buildProviderEnv(provider, apiUrl, token);

    const child = spawn(program, args, {
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

function buildProviderEnv(provider: ProviderKind, baseUrl: string, token: string): NodeJS.ProcessEnv {
  const common = { ...process.env } as NodeJS.ProcessEnv;
  switch (provider) {
    case 'anthropic':
      return {
        ...common,
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: token
      };
    case 'openai':
      return {
        ...common,
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: token
      };
    default:
      return common;
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
