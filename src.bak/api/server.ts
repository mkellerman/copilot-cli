import express, { Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import { ConfigManager } from '../core/config-manager.js';
import { ModelCatalogService } from '../core/services/model-catalog-service.js';
import { setLevel as setLogLevel, setLogFile as setLoggerFile } from '../core/logger.js';
import { registerRoutes } from './routes/index.js';
import { resolveProfileIdForToken } from './routes/auth.js';

export function createApiServer(token?: string) {
  const app = express();
  
  app.use(express.json({ limit: '50mb' }));

  if (process.env.DEBUG) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  app.get('/', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      message: 'GitHub Copilot to OpenAI proxy is running',
      endpoints: {
        chat: '/v1/chat/completions',
        models: '/v1/models',
        legacy_completions: '/v1/completions'
      }
    });
  });

  // Register routes in dedicated modules
  registerRoutes(app, { token });

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

  return app;
}

export interface StartApiServerOptions {
  silent?: boolean;
}

export function startApiServer(
  port: number,
  token?: string,
  host?: string,
  options: StartApiServerOptions = {}
) {
  // Apply runtime logging configuration (env may be set by adapters just before start)
  const verboseRaw = process.env.COPILOT_VERBOSE;
  if (verboseRaw !== undefined) {
    const n = parseInt(verboseRaw as string, 10);
    if (Number.isFinite(n)) setLogLevel(n);
  }
  if (process.env.COPILOT_LOG_FILE) {
    setLoggerFile(process.env.COPILOT_LOG_FILE);
  }
  const app = createApiServer(token);
  const catalogService = ModelCatalogService.getInstance();
  const serviceProfileId = resolveProfileIdForToken(token);
  const appConfig = ConfigManager.getInstance().list();
  const refreshIntervalMs = appConfig.model.refreshIntervalMinutes * 60_000;
  const staleAfterMs = appConfig.catalog.staleMinutes * 60_000;

  const silent = options.silent ?? false;

  if (token && serviceProfileId) {
    catalogService.start({
      intervalMs: refreshIntervalMs,
      staleAfterMs,
      verify: true,
      getAuthContext: async () => ({ profileId: serviceProfileId, token })
    });
  }

  const displayHost = host ?? 'localhost';

  const logBanner = (actualPort: number) => {
    if (silent) return;
    console.log(`GitHub Copilot to OpenAI proxy server running on http://${displayHost}:${actualPort}`);
    console.log(`\nTo use this proxy:`);
    console.log(`1. Authenticate with: copilot-cli auth login`);
    console.log(`2. Point your OpenAI client to: http://${displayHost}:${actualPort}/v1`);
    console.log(`\nExample with curl:`);
    console.log(`curl http://${displayHost}:${actualPort}/v1/chat/completions \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log(`  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'`);
  };

  const server = host
    ? app.listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? (address as AddressInfo).port : port;
        logBanner(actualPort);
      })
    : app.listen(port, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? (address as AddressInfo).port : port;
        logBanner(actualPort);
      });

  server.on('close', () => {
    catalogService.stop();
  });

  return server;
}
