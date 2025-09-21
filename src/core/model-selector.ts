import { loadAuthProfiles } from '../config/index.js';
import { ModelCatalog } from './model-catalog.js';

export interface ModelSelectionResult {
  model: string;
  fallback: boolean;
}

export function resolveProfileIdForToken(token?: string | null): string | undefined {
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

export function listKnownModelsForToken(token?: string | null): string[] {
  const profileId = resolveProfileIdForToken(token);
  if (!profileId) {
    return [];
  }

  const catalog = ModelCatalog.getInstance();
  const entry = catalog.getEntry(profileId);
  return entry?.models ?? [];
}

export function coerceModelToKnown(
  requestedModel: string | undefined,
  defaultModel: string,
  token?: string | null
): ModelSelectionResult {
  const available = listKnownModelsForToken(token);

  if (!requestedModel) {
    return { model: defaultModel, fallback: true };
  }

  if (available.length === 0) {
    if (requestedModel === defaultModel) {
      return { model: defaultModel, fallback: false };
    }
    return { model: defaultModel, fallback: true };
  }

  if (available.includes(requestedModel)) {
    return { model: requestedModel, fallback: false };
  }

  return { model: defaultModel, fallback: true };
}

export async function prefetchModelsForToken(token?: string | null): Promise<void> {
  if (!token) {
    return;
  }

  const profileId = resolveProfileIdForToken(token);
  if (!profileId) {
    return;
  }

  const catalog = ModelCatalog.getInstance();
  const existing = catalog.getEntry(profileId);
  if (existing && existing.models.length > 0) {
    return;
  }

  try {
    await catalog.refresh({ profileId, token, verify: false, source: 'manual' });
  } catch (error) {
    if (process.env.DEBUG) {
      console.error('[model-selector] failed to prefetch models', error);
    }
  }
}
