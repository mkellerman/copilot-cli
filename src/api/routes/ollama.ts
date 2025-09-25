import type { Request, Response } from 'express';
import { ConfigManager } from '../../core/config-manager.js';
import { getLevel, log } from '../../core/logger.js';
import { CopilotHttpClient, type CopilotChatCompletionRequest } from '../../core/copilot-client.js';
import { resolveActiveToken, resolveProfileIdForToken, refreshServerToken } from './auth.js';
import { ModelCatalog, type ModelCatalogEntry } from '../../core/model-catalog.js';
import { testModels } from '../../core/auth.js';
import { detectCommandInBody } from '../commands/detect.js';
import { renderCommandText } from '../commands/text.js';
import { renderAvailableModelsText } from '../commands/models.js';
import { runRequestPipeline, runResponsePipeline, transformsEnabled } from '../transformers/pipeline.js';
import { safeReadText, postChatCompletionWithRefresh, selectModelForRequest } from './helpers.js';

type OllamaMode = 'chat' | 'generate';

interface OllamaMessage {
  role: string;
  content: unknown;
}

interface OllamaRequestBody {
  model?: string;
  messages?: OllamaMessage[];
  prompt?: string;
  system?: string;
  template?: string;
  stream?: boolean;
  options?: Record<string, unknown>;
  temperature?: number;
  top_p?: number;
  num_predict?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

const copilotClient = CopilotHttpClient.getInstance();
const modelCatalog = ModelCatalog.getInstance();

interface RegisterOllamaRouteOptions {
  allowAnonymous?: boolean;
  defaultModel?: string;
}

export function registerOllamaRoutes(
  app: any,
  token: string | undefined,
  sessionModelOverrides: Map<string, string>,
  modelDefaults: Record<string, string>,
  options: RegisterOllamaRouteOptions = {}
) {
  const allowAnonymous = options.allowAnonymous ?? false;
  const sessionDefaultModel = options.defaultModel?.trim();
  app.get('/api/version', (_req: Request, res: Response) => {
    res.json({
      version: 'copilot-oss-1.0',
      compatible: true
    });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/tags', async (req: Request, res: Response) => {
    if (getLevel() >= 1) log(1, 'api', 'GET /api/tags');
    let activeToken = await resolveActiveToken(req, token);
    if (!activeToken) {
      activeToken = await resolveActiveToken(req, token, { refreshIfMissing: true });
    }

    if (!activeToken) {
      if (getLevel() >= 1) log(1, 'auth', 'missing token for /api/tags, serving fallback');
      const payload = buildTagsFallback();
      res.json(payload);
      return;
    }

    const profileId = resolveProfileIdForToken(activeToken);
    let entry: ModelCatalogEntry | undefined;
    if (profileId) {
      entry = modelCatalog.getEntry(profileId);
      if ((!entry || entry.models.length === 0) && getLevel() >= 2) {
        log(2, 'models', 'catalog cold, attempting refresh', { profileId });
      }
      if (!entry || entry.models.length === 0) {
        try {
          entry = await modelCatalog.ensureFreshProfile(profileId, activeToken, { source: 'manual' });
        } catch (error) {
          if (getLevel() >= 1) {
            log(1, 'models', 'catalog refresh failed', { error: (error as any)?.message || String(error) });
          }
        }
      }
    }

    let modelIds = entry?.models ?? [];
    if (modelIds.length === 0) {
      try {
        modelIds = await testModels(activeToken, profileId);
      } catch (error) {
        if (getLevel() >= 1) {
          log(1, 'models', 'fallback discovery failed', { error: (error as any)?.message || String(error) });
        }
      }
    }

    if (modelIds.length === 0) {
      modelIds = ['gpt-4'];
    }

    const modified = entry?.updatedAt ? new Date(entry.updatedAt).toISOString() : new Date().toISOString();
    const payload = buildTagsPayload(modelIds, modified);

    res.json(payload);
  });

  app.post('/api/pull', (req: Request, res: Response) => {
    if (getLevel() >= 1) log(1, 'api', 'POST /api/pull');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const model = typeof body.name === 'string'
      ? (body.name as string)
      : typeof body.model === 'string'
        ? (body.model as string)
        : 'unknown-model';

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`${JSON.stringify(payload)}\n`);
    };

    sendEvent({ status: 'pulling manifest', model });
    sendEvent({ status: 'downloading', model });
    sendEvent({ status: 'success', model });

    res.end();
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    await handleOllamaCompletion('chat', req, res, token, sessionModelOverrides, modelDefaults, allowAnonymous, sessionDefaultModel);
  });

  app.post('/api/generate', async (req: Request, res: Response) => {
    await handleOllamaCompletion('generate', req, res, token, sessionModelOverrides, modelDefaults, allowAnonymous, sessionDefaultModel);
  });
}

async function handleOllamaCompletion(
  mode: OllamaMode,
  req: Request,
  res: Response,
  token: string | undefined,
  sessionModelOverrides: Map<string, string>,
  modelDefaults: Record<string, string>,
  allowAnonymous: boolean,
  sessionDefaultModel?: string
) {
  const path = mode === 'chat' ? '/api/chat' : '/api/generate';
  if (getLevel() >= 1) log(1, 'api', `POST ${path}`);

  const defaultModel = sessionDefaultModel || ConfigManager.getInstance().get<string>('model.default') || 'gpt-4';
  const body = (req.body ?? {}) as OllamaRequestBody;
  const normalizedBody = normalizeBodyForMode(body, mode);
  const normalizedMessages = normalizeMessages(normalizedBody.messages ?? []);
  const commandProbe = { messages: normalizedMessages };

  let activeToken = await resolveActiveToken(req, token);
  if (!activeToken) {
    activeToken = await resolveActiveToken(req, token, { refreshIfMissing: true });
  }
  const preAuthCommand = detectCommandInBody(commandProbe as any);
  if (preAuthCommand) {
    let text: string;
    if (preAuthCommand.command === '--models' || preAuthCommand.command === 'models') {
      text = await renderAvailableModelsText(activeToken ?? undefined);
    } else {
      text = renderCommandText(preAuthCommand.command, preAuthCommand.args, sessionModelOverrides, modelDefaults);
    }
    res.json(buildCommandResponse(mode, text));
    return;
  }

  if (!activeToken) {
    if (allowAnonymous) {
      const requestedModel = typeof normalizedBody.model === 'string' ? normalizedBody.model : defaultModel;
      const streamRequested = normalizedBody.stream !== false;
      respondWithOllamaAnonymousStub(mode, res, requestedModel, streamRequested);
      return;
    }
    await refreshServerToken();
    res.status(401).json({ error: 'No GitHub Copilot token provided. Provide a GitHub token in Authorization header or run: copilot profile login' });
    return;
  }

  let payload: CopilotChatCompletionRequest = buildCopilotPayload(normalizedBody, normalizedMessages, defaultModel);

  const requestedModel = payload.model;
  const selection = await selectModelForRequest(activeToken, requestedModel, defaultModel);
  payload.model = selection.model;
  if (selection.fallback && getLevel() >= 1) {
    log(1, 'model', `Using model ${selection.model} (requested ${requestedModel ?? 'default'}; source=${selection.source}${selection.refreshed ? ', refreshed' : ''})`);
  }

  const abortController = new AbortController();
  const handleAbort = () => {
    abortController.abort();
  };
  req.on('aborted', handleAbort);

  try {
    if (transformsEnabled()) {
      const result = await runRequestPipeline('openai.chat.completions', 'openai', payload.model, true, {}, payload);
      payload = result.payload;
    }

    if (getLevel() >= 2) {
      log(2, 'upstream', '-> POST /chat/completions', { model: payload.model, stream: payload.stream });
    }

    const { response: upstream, token: latestToken } = await postChatCompletionWithRefresh(
      copilotClient,
      activeToken,
      payload,
      abortController
    );
    activeToken = latestToken;

    const stream = payload.stream === true;
    if (stream) {
      await forwardOllamaStreamResponse(mode, upstream, res, payload.model || defaultModel, abortController);
    } else {
      await forwardOllamaJsonResponse(mode, upstream, res, payload.model || defaultModel, payload.model || defaultModel);
    }
  } catch (error) {
    if (getLevel() >= 1) {
      log(1, 'upstream', 'request failed', { error: (error as any)?.message || String(error) });
    }
    if (!res.headersSent) {
      res.status(502).json({
        error: {
          message: (error as any)?.message || 'Failed to reach GitHub Copilot API',
          type: 'upstream_error'
        }
      });
    }
  } finally {
    if (typeof (req as any).off === 'function') {
      (req as any).off('aborted', handleAbort);
    } else {
      req.removeListener('aborted', handleAbort);
    }
  }
}

function normalizeBodyForMode(body: OllamaRequestBody, mode: OllamaMode): OllamaRequestBody {
  if (mode === 'chat') {
    return body;
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const system = typeof body.system === 'string' ? body.system : undefined;
  const template = typeof body.template === 'string' ? body.template : undefined;
  const messages: OllamaMessage[] = [];

  if (system) {
    messages.push({ role: 'system', content: system });
  }
  if (template) {
    messages.push({ role: 'system', content: template });
  }
  messages.push({ role: 'user', content: prompt });

  return {
    ...body,
    messages
  };
}

function normalizeMessages(messages: OllamaMessage[]): Array<{ role: string; content: string }> {
  return messages
    .map((message) => ({
      role: typeof message.role === 'string' ? message.role : 'user',
      content: extractTextContent(message.content)
    }))
    .filter((entry) => entry.content !== '');
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof (part as any).text === 'string') return (part as any).text;
        if (typeof (part as any).content === 'string') return (part as any).content;
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    const maybeText = (content as any).text ?? (content as any).content;
    if (typeof maybeText === 'string') {
      return maybeText;
    }
  }
  return '';
}

function buildCopilotPayload(
  body: OllamaRequestBody,
  messages: Array<{ role: string; content: string }>,
  defaultModel: string
): CopilotChatCompletionRequest {
  const options = body.options ?? {};
  const stream = body.stream !== false;
  const maxTokens = pickNumber(body.max_tokens, options.num_predict, body.num_predict);

  const payload: CopilotChatCompletionRequest = {
    messages,
    model: body.model || defaultModel,
    stream,
    temperature: pickNumber(body.temperature, options.temperature, 0.1),
    top_p: pickNumber(body.top_p, options.top_p),
    presence_penalty: pickNumber(body.presence_penalty, options.presence_penalty),
    frequency_penalty: pickNumber(body.frequency_penalty, options.frequency_penalty)
  };

  payload.max_tokens = typeof maxTokens === 'number' ? maxTokens : 4096;

  return payload;
}

function pickNumber(...candidates: Array<unknown | undefined>): number | undefined {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function buildCommandResponse(mode: OllamaMode, text: string) {
  const created = new Date().toISOString();
  if (mode === 'chat') {
    return {
      model: 'copilot-cli',
      created_at: created,
      message: {
        role: 'assistant',
        content: text
      },
      done: true,
      total_duration: 0,
      load_duration: 0,
      done_reason: 'stop'
    };
  }

  return {
    model: 'copilot-cli',
    created_at: created,
    response: text,
    done: true,
    total_duration: 0,
    load_duration: 0,
    done_reason: 'stop'
  };
}

function respondWithOllamaAnonymousStub(
  mode: OllamaMode,
  res: Response,
  model: string,
  streamRequested: boolean,
  overrideMessage?: string,
  statusCode = 200
) {
  const message = overrideMessage
    || 'No GitHub Copilot token available. Run `copilot profile login` to enable OSS proxy completion.';

  if (streamRequested) {
    res.status(statusCode);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }
    res.write(JSON.stringify(buildStreamChunk(mode, model, message)) + '\n');
    res.write(JSON.stringify(buildDoneChunk(mode, model, message, 'stop', 0)) + '\n');
    res.end();
    return;
  }

  res.status(statusCode).json(buildDoneChunk(mode, model, message, 'stop', 0));
}

async function forwardOllamaStreamResponse(
  mode: OllamaMode,
  upstream: Awaited<ReturnType<typeof fetch>>,
  res: Response,
  model: string,
  abortController: AbortController
): Promise<void> {
  if (!upstream.ok || !upstream.body) {
    if ((upstream.status || 0) === 401) {
      await refreshServerToken();
    }
    const errorText = await safeReadText(upstream);
    res.status(upstream.status || 502).json({ error: errorText || 'GitHub Copilot streaming request failed' });
    return;
  }

  res.status(upstream.status || 200);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aggregate = '';
  let finishReason: string | undefined;
  let done = false;
  const start = typeof process.hrtime.bigint === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;

  try {
    while (true) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) {
        break;
      }
      if (abortController.signal.aborted) {
        done = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const payload = extractSseData(rawEvent);
        if (payload === null) {
          continue;
        }
        if (payload === '[DONE]') {
          done = true;
          break;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const segment = extractDeltaContent(parsed);
        if (segment) {
          aggregate += segment;
          res.write(JSON.stringify(buildStreamChunk(mode, model, segment)) + '\n');
        }
        const reason = parsed?.choices?.[0]?.finish_reason;
        if (typeof reason === 'string') {
          finishReason = reason;
        }
      }

      if (done) {
        break;
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      res.write(JSON.stringify({
        model,
        created_at: new Date().toISOString(),
        done: false,
        error: {
          message: (error as any)?.message || 'Streaming error'
        }
      }) + '\n');
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  if (!done && buffer.trim().length > 0) {
    const leftover = extractSseData(buffer);
    if (leftover && leftover !== '[DONE]') {
      try {
        const parsed = JSON.parse(leftover);
        const segment = extractDeltaContent(parsed);
        if (segment) {
          aggregate += segment;
          res.write(JSON.stringify(buildStreamChunk(mode, model, segment)) + '\n');
        }
        const reason = parsed?.choices?.[0]?.finish_reason;
        if (typeof reason === 'string') {
          finishReason = reason;
        }
      } catch {
        // ignore
      }
    }
  }

  const end = typeof process.hrtime.bigint === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
  const totalDuration = end > start ? Number(end - start) : 0;

  if (!res.writableEnded) {
    res.write(JSON.stringify(buildDoneChunk(mode, model, aggregate, finishReason, totalDuration)) + '\n');
    res.end();
  }
}

async function forwardOllamaJsonResponse(
  mode: OllamaMode,
  upstream: Awaited<ReturnType<typeof fetch>>,
  res: Response,
  model: string,
  fallbackModel: string
): Promise<void> {
  const status = upstream.status || 502;
  const text = await safeReadText(upstream);

  if (!upstream.ok) {
    if (status === 401) {
      await refreshServerToken();
    }
    if (text) {
      try {
        const parsed = JSON.parse(text);
        res.status(status).json(parsed);
        return;
      } catch {
        // fall back to wrapped error
      }
    }
    res.status(status).json({ error: text || `GitHub Copilot API error (${status})` });
    return;
  }

  if (!text) {
    res.status(status).json(buildDoneChunk(mode, model, '', 'stop', 0));
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    res.status(502).json({ error: 'Failed to parse upstream response' });
    return;
  }

  const resolvedModel = model || fallbackModel;

  if (transformsEnabled()) {
    payload = await runResponsePipeline('openai.chat.completions', 'openai', resolvedModel, true, {}, payload);
  }

  const content = extractAssistantContent(payload);
  res.status(status).json(buildDoneChunk(mode, resolvedModel, content, 'stop', 0));
}

function extractSseData(event: string): string | null {
  if (!event) {
    return null;
  }
  const lines = event.split(/\r?\n/);
  const dataLines = lines
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join('');
}

function extractDeltaContent(chunk: any): string {
  const choice = chunk?.choices?.[0];
  if (!choice) {
    return '';
  }
  const delta = choice.delta;
  if (!delta) {
    return '';
  }
  if (typeof delta.content === 'string') {
    return delta.content;
  }
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part: any) => (typeof part?.text === 'string' ? part.text : typeof part?.content === 'string' ? part.content : ''))
      .join('');
  }
  return '';
}

function buildStreamChunk(mode: OllamaMode, model: string, segment: string) {
  const base = {
    model,
    created_at: new Date().toISOString(),
    done: false
  } as any;

  if (mode === 'chat') {
    base.message = {
      role: 'assistant',
      content: segment
    };
  } else {
    base.response = segment;
  }

  return base;
}

function buildDoneChunk(
  mode: OllamaMode,
  model: string,
  content: string,
  reason: string | undefined,
  durationNs: number
) {
  const base = {
    model,
    created_at: new Date().toISOString(),
    done: true,
    done_reason: reason ?? 'stop',
    total_duration: durationNs,
    load_duration: 0,
    prompt_eval_count: 0,
    eval_count: 0
  } as any;

  if (mode === 'chat') {
    base.message = {
      role: 'assistant',
      content
    };
  } else {
    base.response = content;
  }

  return base;
}

function extractAssistantContent(payload: any): string {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return '';
  }
  if (choice?.message) {
    const msg = choice.message;
    if (typeof msg.content === 'string') {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : typeof part?.content === 'string' ? part.content : ''))
        .join('');
    }
  }
  if (typeof choice?.text === 'string') {
    return choice.text;
  }
  return '';
}
function buildTagsPayload(models: string[], modifiedIso: string) {
  return {
    models: models.map((id) => ({
      name: id,
      modified_at: modifiedIso,
      size: 0,
      digest: 'copilot',
      details: {
        family: 'copilot',
        parameter_size: 'unknown',
        quantization_level: 'n/a'
      }
    }))
  };
}

function buildTagsFallback() {
  const models = ['gpt-4', 'gpt-4o', 'gpt-4o-mini'];
  return buildTagsPayload(models, new Date().toISOString());
}
