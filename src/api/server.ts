import express, { Request, Response, NextFunction } from 'express';
import { ConfigManager } from '../core/config-manager.js';
import { CopilotHttpClient, CopilotChatCompletionRequest } from '../core/copilot-client.js';
import { ModelCatalog, type ModelCatalogEntry } from '../core/model-catalog.js';
import { ModelCatalogService } from '../core/services/model-catalog-service.js';
import { testModels } from '../core/auth.js';
import { loadAuthProfiles } from '../config/index.js';

const copilotClient = CopilotHttpClient.getInstance();
const modelCatalog = ModelCatalog.getInstance();

export type ChatCompletionRequest = CopilotChatCompletionRequest;

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

  app.get('/v1/models', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    let activeToken = token;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const providedToken = authHeader.substring(7);
      if (providedToken.startsWith('ghu_') || providedToken.startsWith('ghp_')) {
        activeToken = providedToken;
      }
    }

    if (!activeToken) {
      return res.status(401).json({
        error: {
          message: 'No GitHub Copilot token provided.',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    }

    const profileId = resolveProfileIdForToken(activeToken);

    if (profileId) {
      const cachedEntry = modelCatalog.getEntry(profileId);
      if (cachedEntry && cachedEntry.models.length > 0) {
        return res.json(buildModelsResponse(cachedEntry));
      }
    }

    try {
      const modelIds = await testModels(activeToken, profileId);
      if (modelIds.length > 0) {
        const entry = profileId ? modelCatalog.getEntry(profileId) : undefined;
        return res.json(buildModelsResponse(entry, modelIds));
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.error('[api] model discovery failed:', error);
      }
    }

    res.json(buildDefaultModelsResponse());
  });

  app.post('/v1/chat/completions', async (req: Request<{}, {}, ChatCompletionRequest>, res: Response) => {
    const authHeader = req.headers.authorization;
    let activeToken = token;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const providedToken = authHeader.substring(7);
      if (providedToken.startsWith('ghu_') || providedToken.startsWith('ghp_')) {
        activeToken = providedToken;
      }
    }

    if (!activeToken) {
      return res.status(401).json({
        error: {
          message: 'No GitHub Copilot token provided. Provide a GitHub token in Authorization header or run: copilot-cli auth login',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    }

    const config = ConfigManager.getInstance();
    const defaultModel = config.get<string>('model.default') || 'gpt-4';

    const payload: ChatCompletionRequest = {
      messages: req.body.messages,
      model: req.body.model || defaultModel,
      temperature: req.body.temperature ?? 0.1,
      max_tokens: req.body.max_tokens || 4096,
      stream: req.body.stream || false,
      top_p: req.body.top_p,
      n: req.body.n,
      stop: req.body.stop,
      presence_penalty: req.body.presence_penalty,
      frequency_penalty: req.body.frequency_penalty,
      logit_bias: req.body.logit_bias,
      user: req.body.user
    };

    const abortController = new AbortController();
    const handleClose = () => {
      abortController.abort();
    };

    req.on('close', handleClose);

    try {
      const upstream = await copilotClient.postChatCompletion(activeToken, payload, { signal: abortController.signal });

      if (payload.stream) {
        await forwardStreamResponse(upstream, res, abortController);
      } else {
        await forwardJsonResponse(upstream, res, payload.model || defaultModel);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown upstream error';
      res.status(502).json({
        error: {
          message: `Failed to reach GitHub Copilot API: ${message}`,
          type: 'upstream_error'
        }
      });
    } finally {
      if (typeof (req as any).off === 'function') {
        (req as any).off('close', handleClose);
      } else {
        req.removeListener('close', handleClose);
      }
    }
  });

  app.post('/v1/completions', (req: Request, res: Response, next: NextFunction) => {
    const messages = [
      { role: 'user', content: req.body.prompt }
    ];

    req.body.messages = messages;
    delete req.body.prompt;

    req.url = '/v1/chat/completions';
    next();
  });

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

function resolveProfileIdForToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }

  const profiles = loadAuthProfiles();
  for (const [profileId, profile] of Object.entries(profiles)) {
    if (profile.token === token) {
      return profileId;
    }
  }
  return undefined;
}

function buildModelsResponse(entry?: ModelCatalogEntry, fallbackIds?: string[]) {
  const modelIds = entry && entry.models.length > 0 ? entry.models : (fallbackIds ?? []);
  const createdSeconds = entry ? Math.floor(entry.updatedAt / 1000) : Math.floor(Date.now() / 1000);

  const data = modelIds.map((id) => ({
    id,
    object: 'model',
    created: createdSeconds,
    owned_by: 'github-copilot'
  }));

  const catalogMeta = entry ? {
    status: entry.status,
    updated_at: entry.updatedAt,
    age_ms: entry.ageMs,
    source: entry.source,
    stats: { ...entry.stats },
    failed_models: entry.failedModels ?? []
  } : { status: 'unknown' as const };

  return {
    object: 'list',
    data,
    catalog: catalogMeta
  };
}

function buildDefaultModelsResponse() {
  return {
    object: 'list',
    data: [
      {
        id: 'gpt-4',
        object: 'model',
        created: 1687882410,
        owned_by: 'github-copilot'
      },
      {
        id: 'gpt-3.5-turbo',
        object: 'model',
        created: 1677649963,
        owned_by: 'github-copilot'
      }
    ],
    catalog: {
      status: 'fallback' as const,
      reason: 'default_models'
    }
  };
}

async function forwardStreamResponse(
  upstream: Awaited<ReturnType<typeof fetch>>,
  res: Response,
  abortController: AbortController
): Promise<void> {
  if (!upstream.ok || !upstream.body) {
    const errorText = await safeReadText(upstream);
    res.status(upstream.status || 502).json({
      error: {
        message: errorText || 'GitHub Copilot streaming request failed',
        type: 'upstream_error',
        code: upstream.status || 502
      }
    });
    return;
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const reader = upstream.body.getReader();
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (value && value.length) {
        res.write(Buffer.from(value));
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      const message = error instanceof Error ? error.message : 'Unknown streaming error';
      res.write(`data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`);
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {});
    } else {
      reader.releaseLock();
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}

async function forwardJsonResponse(
  upstream: Awaited<ReturnType<typeof fetch>>,
  res: Response,
  fallbackModel: string
): Promise<void> {
  const status = upstream.status || 502;
  const text = await safeReadText(upstream);

  if (!upstream.ok) {
    if (text) {
      try {
        const parsed = JSON.parse(text);
        res.status(status).json(parsed);
        return;
      } catch {
        // fall through to wrapped error envelope
      }
    }

    res.status(status).json({
      error: {
        message: text || `GitHub Copilot API error (${status})`,
        type: 'upstream_error',
        code: status
      }
    });
    return;
  }

  if (!text) {
    res.status(status).json({ object: 'chat.completion', model: fallbackModel, choices: [] });
    return;
  }

  try {
    const payload = JSON.parse(text);
    payload.object = payload.object ?? 'chat.completion';
    payload.model = payload.model ?? fallbackModel;
    payload.created = payload.created ?? Math.floor(Date.now() / 1000);
    res.status(status).json(payload);
  } catch {
    res.status(502).json({
      error: {
        message: 'Failed to parse upstream response',
        type: 'parse_error'
      }
    });
  }
}

async function safeReadText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function startApiServer(port: number, token?: string, host?: string) {
  const app = createApiServer(token);
  const catalogService = ModelCatalogService.getInstance();
  const serviceProfileId = resolveProfileIdForToken(token);
  const appConfig = ConfigManager.getInstance().list();
  const refreshIntervalMs = appConfig.model.refreshIntervalMinutes * 60_000;
  const staleAfterMs = appConfig.catalog.staleMinutes * 60_000;

  if (token && serviceProfileId) {
    catalogService.start({
      intervalMs: refreshIntervalMs,
      staleAfterMs,
      verify: true,
      getAuthContext: async () => ({ profileId: serviceProfileId, token })
    });
  }

  const displayHost = host ?? 'localhost';

  const onListen = () => {
    console.log(`GitHub Copilot to OpenAI proxy server running on http://${displayHost}:${port}`);
    console.log(`\nTo use this proxy:`);
    console.log(`1. Authenticate with: copilot-cli auth login`);
    console.log(`2. Point your OpenAI client to: http://${displayHost}:${port}/v1`);
    console.log(`\nExample with curl:`);
    console.log(`curl http://${displayHost}:${port}/v1/chat/completions \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log(`  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'`);
  };

  const server = host
    ? app.listen(port, host, onListen)
    : app.listen(port, onListen);

  server.on('close', () => {
    catalogService.stop();
  });

  return server;
}
