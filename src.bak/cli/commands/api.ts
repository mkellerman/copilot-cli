import { startApiServer } from '../../api/server.js';
import { ConfigManager } from '../../core/config-manager.js';
import { loadAuthInfo, loadToken, DEFAULT_PORT } from '../../config/index.js';

interface ApiOptions {
  port?: number;
  token?: string;
  debug?: boolean;
  verbose?: number;
  silent?: boolean;
}

export async function run(options: ApiOptions): Promise<void> {
  const config = ConfigManager.getInstance();

  const port = options.port ?? config.get<number>('api.port') ?? DEFAULT_PORT;
  const host = config.get<string>('api.host') || 'localhost';
  const debug = options.debug ?? config.get<boolean>('debug') ?? false;
  const silent = options.silent ?? false;
  if (typeof options.verbose === 'number') {
    process.env.COPILOT_VERBOSE = String(options.verbose);
  }

  if (debug) {
    process.env.DEBUG = 'true';
  }

  const explicitToken = options.token?.trim();
  const authInfo = loadAuthInfo();
  const storedToken = authInfo?.token || loadToken();
  const token = explicitToken || storedToken;

  if (!token) {
    throw new Error('No authentication token found. Run: copilot-cli auth login');
  }

  if (!silent) {
    console.log(`Starting API server on http://${host}:${port}`);
  }
  startApiServer(port, token, host, { silent });
}
