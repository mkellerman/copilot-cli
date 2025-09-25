import express, { Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import { ConfigManager } from '../core/config-manager.js';
import { ModelCatalogService } from '../core/services/model-catalog-service.js';
import { setLevel as setLogLevel, setLogFile as setLoggerFile, getLevel, log as loggerLog } from '../core/logger.js';
import { registerRoutes } from './routes/index.js';
import type { ApiSchema } from './routes/index.js';
import { resolveProfileIdForToken, getServerToken } from './routes/auth.js';

export function createApiServer(token?: string, schema: ApiSchema = 'openai', defaultModelOverride?: string) {
  const app = express();
  
  app.use(express.json({ limit: '50mb' }));

  if (getLevel() >= 1) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      const snapshotLevel = getLevel();
      const meta: any = { method: req.method, path: req.originalUrl };
      if (snapshotLevel >= 2 && Object.keys(req.query || {}).length > 0) {
        meta.query = req.query;
      }
      if (snapshotLevel >= 3 && req.body && Object.keys(req.body).length > 0) {
        meta.body = req.body;
      }
      loggerLog(1, 'http', 'request', meta);
      res.on('finish', () => {
        const durationMs = Date.now() - start;
        const completionMeta: any = {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: durationMs
        };
        if (snapshotLevel >= 2) {
          completionMeta.bytes_sent = Number(res.getHeader('content-length')) || undefined;
        }
        loggerLog(1, 'http', 'response', completionMeta);
      });
      next();
    });
  } else if (process.env.DEBUG) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  app.get('/', (req: Request, res: Response) => {
    if (schema === 'ollama') {
      res.json({
        status: 'ok',
        message: 'GitHub Copilot OSS proxy is running',
        endpoints: {
          chat: '/api/chat',
          generate: '/api/generate',
          models: '/api/tags'
        }
      });
      return;
    }

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
  registerRoutes(app, { token, schema, defaultModel: defaultModelOverride });

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
  schema?: ApiSchema;
  defaultModelOverride?: string;
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
  const schema = options.schema ?? 'openai';
  const app = createApiServer(token, schema, options.defaultModelOverride);
  const catalogService = ModelCatalogService.getInstance();
  const serviceProfileId = resolveProfileIdForToken(token);
  const appConfig = ConfigManager.getInstance().list();
  const refreshIntervalMs = appConfig.model.refreshIntervalMinutes * 60_000;
  const staleAfterMs = appConfig.catalog.staleMinutes * 60_000;

  const silent = options.silent ?? false;

  if (serviceProfileId) {
    catalogService.start({
      intervalMs: refreshIntervalMs,
      staleAfterMs,
      verify: true,
      getAuthContext: async () => {
        const latestToken = await getServerToken({ refreshIfMissing: true });
        if (!latestToken) {
          return null;
        }
        return { profileId: serviceProfileId, token: latestToken };
      }
    });
  }

  const displayHost = host ?? 'localhost';

  const sessionModelLabel = options.defaultModelOverride?.trim();

  const logBanner = (actualPort: number) => {
    if (silent) return;
    if (schema === 'ollama') {
      console.log(`GitHub Copilot OSS proxy server running on http://${displayHost}:${actualPort}`);
      if (sessionModelLabel) {
        console.log(`Session default model: ${sessionModelLabel}`);
      }
      console.log(`\nTo use this proxy:`);
      console.log(`1. Authenticate with: copilot profile login`);
      console.log(`2. Point your Ollama-compatible client to: http://${displayHost}:${actualPort}`);
      console.log(`\nExample with curl:`);
      console.log(`curl http://${displayHost}:${actualPort}/api/chat \\`);
      console.log('  -H "Content-Type: application/json" \\');
      console.log(`  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'`);
      return;
    }

    console.log(`GitHub Copilot to OpenAI proxy server running on http://${displayHost}:${actualPort}`);
    if (sessionModelLabel) {
      console.log(`Session default model: ${sessionModelLabel}`);
    }
    console.log(`\nTo use this proxy:`);
    console.log(`1. Authenticate with: copilot profile login`);
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
