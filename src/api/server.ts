import express, { Request, Response, NextFunction } from 'express';
import https from 'https';
import { COPILOT_HOST } from '../config/index.js';
import { ConfigManager } from '../core/config-manager.js';
import { testModels } from '../core/auth.js';

export interface ChatCompletionRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  n?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
}

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

    try {
      const modelIds = await testModels(activeToken);
      const models = modelIds.map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'github-copilot'
      }));
      
      res.json({
        object: 'list',
        data: models
      });
    } catch (error) {
      // On error, return default models
      res.json({
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
        ]
      });
    }
  });

  app.post('/v1/chat/completions', (req: Request<{}, {}, ChatCompletionRequest>, res: Response) => {
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

    // Use configured default model if not specified
    const config = ConfigManager.getInstance();
    const defaultModel = config.get('model.default') || 'gpt-4';

    const requestData = JSON.stringify({
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
    });

    const options = {
      hostname: COPILOT_HOST,
      port: 443,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeToken}`,
        'Content-Length': Buffer.byteLength(requestData).toString(),
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.0',
        'Openai-Organization': 'github-copilot',
        'User-Agent': 'GitHubCopilotChat/0.11.0'
      }
    };

    if (req.body.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const proxyReq = https.request(options, (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
          let errorData = '';
          proxyRes.on('data', chunk => errorData += chunk.toString());
          proxyRes.on('end', () => {
            res.write(`data: ${JSON.stringify({ error: { message: `Upstream error: ${errorData}`, code: proxyRes.statusCode } })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          });
          return;
        }

        proxyRes.on('data', (chunk) => {
          res.write(chunk);
        });

        proxyRes.on('end', () => {
          res.end();
        });
      });

      proxyReq.on('error', (error) => {
        res.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });

      proxyReq.write(requestData);
      proxyReq.end();
    } else {
      const proxyReq = https.request(options, (proxyRes) => {
        let responseData = '';
        
        proxyRes.on('data', (chunk) => {
          responseData += chunk.toString();
        });

        proxyRes.on('end', () => {
          if (proxyRes.statusCode !== 200) {
            res.status(proxyRes.statusCode || 500).json({
              error: {
                message: `GitHub Copilot API error: ${responseData}`,
                type: 'upstream_error',
                code: proxyRes.statusCode
              }
            });
          } else {
            try {
              const response = JSON.parse(responseData);
              response.object = response.object || 'chat.completion';
              response.model = response.model || req.body.model || 'gpt-4';
              response.created = response.created || Math.floor(Date.now() / 1000);
              
              res.json(response);
            } catch (e) {
              res.status(500).json({
                error: {
                  message: 'Failed to parse upstream response',
                  type: 'parse_error'
                }
              });
            }
          }
        });
      });

      proxyReq.on('error', (error) => {
        res.status(500).json({
          error: {
            message: error.message,
            type: 'connection_error'
          }
        });
      });

      proxyReq.write(requestData);
      proxyReq.end();
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

export function startApiServer(port: number, token?: string) {
  const app = createApiServer(token);
  
  const server = app.listen(port, () => {
    console.log(`GitHub Copilot to OpenAI proxy server running on http://localhost:${port}`);
    console.log(`\nTo use this proxy:`);
    console.log(`1. Authenticate with: copilot-cli auth login`);
    console.log(`2. Point your OpenAI client to: http://localhost:${port}/v1`);
    console.log(`\nExample with curl:`);
    console.log(`curl http://localhost:${port}/v1/chat/completions \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'`);
  });

  return server;
}