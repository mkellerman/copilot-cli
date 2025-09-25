import type { Express } from 'express';
import { MODEL_MAP } from '../handlers/anthropic.js';
import { registerModelsRoutes } from './models.js';
import { registerOpenAIRoutes } from './openai.js';
import { registerAnthropicRoutes } from './anthropic.js';
import { registerOllamaRoutes } from './ollama.js';
import { primeServerToken } from './auth.js';

export type ApiSchema = 'openai' | 'ollama';

export interface RouteRegistrationOptions {
  token?: string;
  schema?: ApiSchema;
  defaultModel?: string;
}

export function registerRoutes(app: Express, options: RouteRegistrationOptions = {}) {
  const { token, schema = 'openai', defaultModel } = options;
  primeServerToken(token);
  const sessionModelOverrides = new Map<string, string>();

  registerModelsRoutes(app, token, {
    allowAnonymous: schema === 'ollama'
  });
  registerOpenAIRoutes(app, token, sessionModelOverrides, MODEL_MAP, {
    allowAnonymous: schema === 'ollama',
    defaultModel
  });
  registerAnthropicRoutes(app, token, sessionModelOverrides, MODEL_MAP);
  if (schema === 'ollama') {
    registerOllamaRoutes(app, token, sessionModelOverrides, MODEL_MAP, {
      allowAnonymous: true,
      defaultModel
    });
  }
}
