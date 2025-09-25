import type { Response } from 'express';
import { CopilotHttpClient, type CopilotChatCompletionRequest } from '../../core/copilot-client.js';
import { ModelCatalog } from '../../core/model-catalog.js';
import { resolveProfileIdForToken as resolveProfileIdForTokenFromCatalog } from '../../core/model-selector.js';
import { getLevel, log } from '../../core/logger.js';
import { refreshServerToken, primeServerToken } from './auth.js';

const modelCatalog = ModelCatalog.getInstance();

export async function forwardStreamResponse(
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
      res.write(`data: {"error": {"message": "${message.replace(/"/g, '\\"')}", "type": "stream_error"}}\n\n`);
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

export async function forwardJsonResponse(
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

export async function safeReadText(response: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export interface CopilotCompletionResult {
  response: Awaited<ReturnType<typeof fetch>>;
  token: string;
  refreshed: boolean;
}

export async function postChatCompletionWithRefresh(
  client: CopilotHttpClient,
  token: string,
  payload: CopilotChatCompletionRequest,
  abortController: AbortController
): Promise<CopilotCompletionResult> {
  let currentToken = token;
  const response = await client.postChatCompletion(currentToken, payload, { signal: abortController.signal });
  if (response.status === 401 && !abortController.signal.aborted) {
    await response.body?.cancel?.();
    const nextToken = await refreshServerToken();
    if (nextToken && nextToken !== currentToken) {
      primeServerToken(nextToken);
      if (getLevel() >= 1) {
        log(1, 'auth', 'Refreshed Copilot token after upstream 401');
      }
      const retried = await client.postChatCompletion(nextToken, payload, { signal: abortController.signal });
      return { response: retried, token: nextToken, refreshed: true };
    }
  }

  return { response, token: currentToken, refreshed: false };
}

type ModelSelectionSource = 'requested' | 'default' | 'catalog' | 'configured';

export interface ModelSelectionResult {
  model: string;
  fallback: boolean;
  source: ModelSelectionSource;
  refreshed: boolean;
}

export async function selectModelForRequest(
  token: string | undefined | null,
  requestedModel: string | undefined,
  defaultModel: string
): Promise<ModelSelectionResult> {
  const trimmedRequested = typeof requestedModel === 'string' ? requestedModel.trim() : undefined;
  const trimmedDefault = defaultModel?.trim?.() || 'gpt-4';

  const pickConfigured = (): ModelSelectionResult => ({
    model: trimmedRequested || trimmedDefault,
    fallback: !!trimmedRequested && trimmedRequested !== trimmedDefault,
    source: 'configured',
    refreshed: false
  });

  const findCanonical = (models: string[], target?: string): string | undefined => {
    if (!target) return undefined;
    const lower = target.trim().toLowerCase();
    return models.find((id) => id.toLowerCase() === lower);
  };

  const attemptSelect = (models: string[]): { model: string; fallback: boolean; source: ModelSelectionSource } | undefined => {
    if (!models || models.length === 0) {
      return undefined;
    }
    const canonicalRequested = findCanonical(models, trimmedRequested);
    if (canonicalRequested) {
      return { model: canonicalRequested, fallback: false, source: 'requested' };
    }
    const canonicalDefault = findCanonical(models, trimmedDefault);
    if (canonicalDefault) {
      const fallback = trimmedRequested !== undefined;
      return { model: canonicalDefault, fallback, source: 'default' };
    }
    return { model: models[0], fallback: true, source: 'catalog' };
  };

  if (!token) {
    return pickConfigured();
  }

  const profileId = resolveProfileIdForTokenFromCatalog(token);
  if (!profileId) {
    return pickConfigured();
  }

  let entry = modelCatalog.getEntry(profileId);
  let attempt = attemptSelect(entry?.models ?? []);
  let refreshed = false;

  const needsRefresh = !attempt || attempt.source === 'catalog';
  if (needsRefresh) {
    try {
      entry = await modelCatalog.refresh({ profileId, token, verify: false, source: 'manual' });
      refreshed = true;
      attempt = attemptSelect(entry?.models ?? []);
    } catch (error) {
      if (getLevel() >= 1) {
        log(1, 'models', 'model refresh failed', { error: (error as any)?.message || String(error) });
      }
    }
  }

  if (attempt) {
    return { ...attempt, refreshed };
  }

  return pickConfigured();
}
