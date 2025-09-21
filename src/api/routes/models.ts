import type { Request, Response } from 'express';
import { ModelCatalog } from '../../core/model-catalog.js';
import { getLevel, log } from '../../core/logger.js';
import { testModels } from '../../core/auth.js';
import type { ModelCatalogEntry } from '../../core/model-catalog.js';
import { resolveActiveToken, resolveProfileIdForToken } from './auth.js';

const modelCatalog = ModelCatalog.getInstance();

export function registerModelsRoutes(app: any, token?: string) {
  app.get('/v1/models', async (req: Request, res: Response) => {
    if (getLevel() >= 1) log(1, 'api', 'GET /v1/models');
    const activeToken = resolveActiveToken(req, token);

    if (!activeToken) {
      if (getLevel() >= 1) log(1, 'auth', 'missing token for /v1/models');
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
        if (getLevel() >= 2) log(2, 'models', 'serving from cache', { count: cachedEntry.models.length });
        return res.json(buildModelsResponse(cachedEntry));
      }
    }

    try {
      const modelIds = await testModels(activeToken, profileId);
      if (modelIds.length > 0) {
        if (getLevel() >= 2) log(2, 'models', 'discovered', { count: modelIds.length });
        const entry = profileId ? modelCatalog.getEntry(profileId) : undefined;
        return res.json(buildModelsResponse(entry, modelIds));
      }
    } catch (error) {
      if (getLevel() >= 1) log(1, 'models', 'discovery failed', { error: (error as any)?.message || String(error) });
    }

    res.json(buildDefaultModelsResponse());
  });
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
