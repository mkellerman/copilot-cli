import { startApiServer } from '../../api/server.js';
import { ConfigManager } from '../../core/config-manager.js';
import { loadAuthInfo, loadToken, DEFAULT_PORT } from '../../config/index.js';

export interface ApiCommandOptions {
  port?: number;
  token?: string;
  silent?: boolean;
}

export async function runApiCommand(options: ApiCommandOptions): Promise<void> {
  const config = ConfigManager.getInstance();

  const port = options.port ?? config.get<number>('api.port') ?? DEFAULT_PORT;
  const host = config.get<string>('api.host') || 'localhost';
  const silent = options.silent ?? false;

  const explicitToken = options.token?.trim();
  const authInfo = loadAuthInfo();
  const storedToken = authInfo?.token || loadToken();
  const token = explicitToken || storedToken;

  if (!token) {
    throw new Error('No authentication token found. Run: copilot profile login');
  }

  if (!silent) {
    console.log(`Starting API server on http://${host}:${port}`);
  }

  startApiServer(port, token, host, { silent });
}
