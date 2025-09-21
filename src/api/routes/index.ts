import type { Express } from 'express';
import { MODEL_MAP } from '../handlers/anthropic.js';
import { registerModelsRoutes } from './models.js';
import { registerOpenAIRoutes } from './openai.js';
import { registerAnthropicRoutes } from './anthropic.js';

export interface RouteRegistrationOptions {
  token?: string;
}

export function registerRoutes(app: Express, options: RouteRegistrationOptions = {}) {
  const { token } = options;
  const sessionModelOverrides = new Map<string, string>();

  registerModelsRoutes(app, token);
  registerOpenAIRoutes(app, token, sessionModelOverrides, MODEL_MAP);
  registerAnthropicRoutes(app, token, sessionModelOverrides, MODEL_MAP);
}

