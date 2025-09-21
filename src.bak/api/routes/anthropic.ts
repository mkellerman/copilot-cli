import type { Request, Response } from 'express';
import { ConfigManager } from '../../core/config-manager.js';
import { getLevel, log } from '../../core/logger.js';
import { CopilotHttpClient } from '../../core/copilot-client.js';
import { resolveActiveToken } from './auth.js';
import { detectCommandInBody } from '../commands/detect.js';
import { renderCommandText } from '../commands/text.js';
import { buildAnthropicCommandResponse } from '../commands/responders.js';
import { toAnthropicResponse, toChatCompletionRequest, type AnthropicMessageRequest, type AnthropicConversionResult } from '../handlers/anthropic.js';
import { renderAvailableModelsText } from '../commands/models.js';
import { runRequestPipeline, runResponsePipeline, transformsEnabled } from '../transformers/pipeline.js';

const copilotClient = CopilotHttpClient.getInstance();

export function registerAnthropicRoutes(app: any, token: string | undefined, sessionModelOverrides: Map<string, string>, modelDefaults: Record<string, string>) {
  app.post('/v1/messages', async (req: Request<{}, {}, AnthropicMessageRequest>, res: Response) => {
    if (getLevel() >= 1) log(1, 'api', 'POST /v1/messages');
    if (getLevel() >= 3) log(3, 'api', 'request body', req.body);
    // Intercept in-chat commands before auth so help-like commands work without a token
    const preAuthCommand = detectCommandInBody(req.body);
    if (preAuthCommand) {
      if (getLevel() >= 1) log(1, 'cmd', `Intercepted ${preAuthCommand.command}`);
      let text: string;
      if (preAuthCommand.command === '--models') {
        const activeToken = resolveActiveToken(req, token);
        text = await renderAvailableModelsText(activeToken || undefined);
      } else {
        text = renderCommandText(preAuthCommand.command, preAuthCommand.args, sessionModelOverrides, modelDefaults);
      }
      const response = buildAnthropicCommandResponse(text);
      res.json(response);
      return;
    }

    const activeToken = resolveActiveToken(req, token);

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

    let conversion: AnthropicConversionResult | null = null;
    let completionRequest;
    try {
      conversion = toChatCompletionRequest(req.body, defaultModel, sessionModelOverrides);
      completionRequest = conversion.request;
    } catch (error: any) {
      return res.status(400).json({
        error: {
          message: error?.message || 'Invalid request payload',
          type: 'invalid_request_error'
        }
      });
    }

    if (completionRequest.stream) {
      return res.status(400).json({
        error: {
          message: 'Anthropic streaming is not yet supported',
          type: 'invalid_request_error'
        }
      });
    }

    completionRequest.stream = false;

    try {
      if (transformsEnabled()) {
        const result = await runRequestPipeline('anthropic.messages', 'anthropic', completionRequest.model, !!activeToken, { modelOverrides: sessionModelOverrides }, completionRequest);
        completionRequest = result.payload;
      }
      if (getLevel() >= 2) log(2, 'upstream', '-> POST /chat/completions', { model: completionRequest.model, stream: completionRequest.stream });
      const response = await copilotClient.postChatCompletion(activeToken, completionRequest);
      const text = await response.text();

      if (!response.ok) {
        if (getLevel() >= 2) log(2, 'upstream', `<- ${response.status} /chat/completions`, { body: text });
        let message = text || `GitHub Copilot API error (${response.status})`;
        try {
          const data = JSON.parse(text);
          message = (data as any)?.error?.message || message;
        } catch {
          // ignore parse errors
        }
        return res.status(response.status || 502).json({
          error: {
            message,
            type: 'upstream_error'
          }
        });
      }

      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        return res.status(502).json({
          error: {
            message: 'Failed to parse upstream response',
            type: 'parse_error'
          }
        });
      }

      const anthropicModel = conversion?.requestedModel ?? defaultModel;
      if (transformsEnabled()) {
        payload = await runResponsePipeline('anthropic.messages', 'anthropic', anthropicModel, !!activeToken, { modelOverrides: sessionModelOverrides }, payload);
      }
      const anthropicResponse = toAnthropicResponse(payload, anthropicModel);
      res.json(anthropicResponse);
    } catch (error: any) {
      if (getLevel() >= 1) log(1, 'upstream', 'request failed', { error: error?.message || String(error) });
      res.status(502).json({
        error: {
          message: error?.message || 'Failed to reach GitHub Copilot API',
          type: 'upstream_error'
        }
      });
    }
  });
}
