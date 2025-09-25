import type { Request, Response, NextFunction } from 'express';
import { ConfigManager } from '../../core/config-manager.js';
import { getLevel, log } from '../../core/logger.js';
import { CopilotHttpClient, type CopilotChatCompletionRequest } from '../../core/copilot-client.js';
import { resolveActiveToken, refreshServerToken } from './auth.js';
import { detectCommandInBody } from '../commands/detect.js';
import { renderCommandText } from '../commands/text.js';
import { buildOpenAICommandResponse } from '../commands/responders.js';
import { forwardStreamResponse, forwardJsonResponse, safeReadText, postChatCompletionWithRefresh, selectModelForRequest } from './helpers.js';
import { renderAvailableModelsText } from '../commands/models.js';
import { runRequestPipeline, runResponsePipeline, transformsEnabled } from '../transformers/pipeline.js';

const copilotClient = CopilotHttpClient.getInstance();

interface RegisterOpenAiRouteOptions {
  allowAnonymous?: boolean;
  defaultModel?: string;
}

export function registerOpenAIRoutes(
  app: any,
  token: string | undefined,
  sessionModelOverrides: Map<string, string>,
  modelDefaults: Record<string, string>,
  options: RegisterOpenAiRouteOptions = {}
) {
  const allowAnonymous = options.allowAnonymous ?? false;
  const sessionDefaultModel = options.defaultModel?.trim();
  app.post('/v1/chat/completions', async (req: Request<{}, {}, CopilotChatCompletionRequest>, res: Response) => {
    if (getLevel() >= 1) log(1, 'api', 'POST /v1/chat/completions');
    if (getLevel() >= 3) log(3, 'api', 'request body', req.body);
    // Intercept in-chat commands before auth so help-like commands work without a token
    const preAuthCommand = detectCommandInBody(req.body as any);
    if (preAuthCommand) {
      if (getLevel() >= 1) log(1, 'cmd', `Intercepted ${preAuthCommand.command}`);
      let text: string;
      if (preAuthCommand.command === '--models' || preAuthCommand.command === 'models') {
        let displayToken = await resolveActiveToken(req, token);
        if (!displayToken) {
          displayToken = await resolveActiveToken(req, token, { refreshIfMissing: true });
        }
        text = await renderAvailableModelsText(displayToken || undefined);
      } else {
        text = renderCommandText(preAuthCommand.command, preAuthCommand.args, sessionModelOverrides, modelDefaults);
      }
      const response = buildOpenAICommandResponse(text);
      res.json(response);
      return;
    }

    let activeToken = await resolveActiveToken(req, token);
    if (!activeToken) {
      activeToken = await resolveActiveToken(req, token, { refreshIfMissing: true });
    }

    const requestedModelName = typeof req.body?.model === 'string' && req.body.model.trim()
      ? req.body.model.trim()
      : ConfigManager.getInstance().get<string>('model.default') || 'gpt-4';
    const streamRequested = req.body?.stream === true;

    if (!activeToken) {
      if (allowAnonymous) {
        respondWithOpenAIAnonymousStub(res, requestedModelName, streamRequested);
        return;
      }
      await refreshServerToken();
      return res.status(401).json({
        error: {
          message: 'No GitHub Copilot token provided. Provide a GitHub token in Authorization header or run: copilot profile login',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    }

    const config = ConfigManager.getInstance();
    const defaultModel = sessionDefaultModel || config.get<string>('model.default') || 'gpt-4';

    let payload: CopilotChatCompletionRequest = {
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

    const requestedModel = payload.model;
    const selection = await selectModelForRequest(activeToken, requestedModel, defaultModel);
    payload.model = selection.model;
    if (selection.fallback && getLevel() >= 1) {
      log(1, 'model', `Using model ${selection.model} (requested ${requestedModel ?? 'default'}; source=${selection.source}${selection.refreshed ? ', refreshed' : ''})`);
    }

    const abortController = new AbortController();
    const handleClose = () => {
      abortController.abort();
    };

    req.on('close', handleClose);

    try {
      if (transformsEnabled()) {
        const result = await runRequestPipeline('openai.chat.completions', 'openai', payload.model, !!activeToken, { }, payload);
        payload = result.payload;
      }
      if (getLevel() >= 2) log(2, 'upstream', '-> POST /chat/completions', { model: payload.model, stream: payload.stream });
      const { response: upstream, token: latestToken } = await postChatCompletionWithRefresh(
        copilotClient,
        activeToken,
        payload,
        abortController
      );
      activeToken = latestToken;

      if (payload.stream) {
        await forwardStreamResponse(upstream, res, abortController);
      } else {
        const status = upstream.status || 502;
        const text = await safeReadText(upstream);
        if (getLevel() >= 2) log(2, 'upstream', `<- ${status} /chat/completions`);
        if (!upstream.ok) {
          if (text) {
            try {
              const parsed = JSON.parse(text);
              return res.status(status).json(parsed);
            } catch {
              // fallthrough
            }
          }
          return res.status(status).json({
            error: {
              message: text || `GitHub Copilot API error (${status})`,
              type: 'upstream_error',
              code: status
            }
          });
        }

        if (!text) {
          return res.status(status).json({ object: 'chat.completion', model: payload.model || defaultModel, choices: [] });
        }

        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          return res.status(502).json({ error: { message: 'Failed to parse upstream response', type: 'parse_error' } });
        }

        if (transformsEnabled()) {
          json = await runResponsePipeline('openai.chat.completions', 'openai', payload.model || defaultModel, !!activeToken, { }, json);
        }
        json.object = json.object ?? 'chat.completion';
        json.model = json.model ?? (payload.model || defaultModel);
        json.created = json.created ?? Math.floor(Date.now() / 1000);
        res.status(status).json(json);
      }
    } catch (error) {
      if (getLevel() >= 1) log(1, 'upstream', 'request failed', { error: (error as any)?.message || String(error) });
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

  // Legacy completions proxy
  app.post('/v1/completions', (req: Request, res: Response, next: NextFunction) => {
    const messages = [
      { role: 'user', content: (req.body as any).prompt }
    ];

    (req.body as any).messages = messages;
    delete (req.body as any).prompt;

    req.url = '/v1/chat/completions';
    next();
  });
}

function respondWithOpenAIAnonymousStub(
  res: Response,
  model: string,
  streamRequested: boolean,
  overrideMessage?: string,
  statusCode = 200
) {
  const message = overrideMessage
    || 'No GitHub Copilot token available. Run `copilot profile login` to enable chat completions through the OSS proxy.';
  const created = Math.floor(Date.now() / 1000);
  const id = `anon_${Date.now()}`;

  if (streamRequested) {
    res.status(statusCode);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const flushHeaders = (res as any).flushHeaders;
    if (typeof flushHeaders === 'function') {
      flushHeaders.call(res);
    }

    const buildChunk = (delta: Record<string, unknown>, finishReason: string | null) =>
      JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta,
            finish_reason: finishReason
          }
        ]
      });

    res.write(`data: ${buildChunk({ role: 'assistant', content: message }, null)}\n\n`);
    res.write(`data: ${buildChunk({}, 'stop')}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.status(statusCode).json({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: message
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  });
}
