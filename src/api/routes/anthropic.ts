import type { Request, Response } from 'express';
import { ConfigManager } from '../../core/config-manager.js';
// ...existing code...
import { coerceModelToKnown } from '../../core/model-selector.js';
import { getLevel, log } from '../../core/logger.js';
import { CopilotHttpClient } from '../../core/copilot-client.js';
import { resolveActiveToken, refreshServerToken } from './auth.js';
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
      if (preAuthCommand.command === '--models' || preAuthCommand.command === 'models') {
        let displayToken = await resolveActiveToken(req, token);
        if (!displayToken) {
          displayToken = await resolveActiveToken(req, token, { refreshIfMissing: true });
        }
        text = await renderAvailableModelsText(displayToken || undefined);
      } else if (preAuthCommand.command === 'config') {
        // Implement config logic (list, get, set)
        const config = ConfigManager.getInstance();
        const { CONFIG_PATHS } = await import('../../config/schema.js');
        const args = preAuthCommand.args;
        if (args.length === 0) {
          // List all config
          const all = config.list();
          let output = 'Current configuration:\n';
          for (const key of CONFIG_PATHS) {
            output += `  ${key}: ${JSON.stringify(config.get(key))}\n`;
          }
          text = output;
        } else if (args[0] === 'set' && args.length >= 3) {
          // Set config value
          const key = args[1];
          if (!CONFIG_PATHS.includes(key as any)) {
            text = `Invalid config key: ${key}`;
          } else {
            const value = args.slice(2).join(' ');
            try {
              await config.set(key as import('../../config/schema.js').ConfigPath, value);
              text = `Set ${key} = ${value}`;
            } catch (err: any) {
              text = `Failed to set config: ${err.message || err}`;
            }
          }
        } else if (args[0] === 'set' && args.length < 3) {
          text = 'Usage: ::config set [key] [value]';
        } else {
          // Show value for a specific key
          const key = args[0];
          if (!CONFIG_PATHS.includes(key as any)) {
            text = `Invalid config key: ${key}`;
          } else {
            const value = config.get(key as import('../../config/schema.js').ConfigPath);
            if (value === undefined) {
              text = `No value set for '${key}'.`;
            } else {
              text = `${key}: ${JSON.stringify(value)}`;
            }
          }
        }
      } else {
        text = renderCommandText(preAuthCommand.command, preAuthCommand.args, sessionModelOverrides, modelDefaults);
      }
      const response = buildAnthropicCommandResponse(text);
      res.json(response);
      return;
    }

    let activeToken = await resolveActiveToken(req, token);
    if (!activeToken) {
      activeToken = await resolveActiveToken(req, token, { refreshIfMissing: true });
    }

    if (!activeToken) {
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

    const requestedModel = completionRequest.model;
    const selection = coerceModelToKnown(requestedModel, defaultModel, activeToken);
    if (selection.fallback && requestedModel && requestedModel !== selection.model && getLevel() >= 1) {
      log(1, 'model', `Falling back to default model ${selection.model} (requested ${requestedModel})`);
    }
    completionRequest.model = selection.model;

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
        if (response.status === 401) {
          await refreshServerToken();
        }
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

      // Debug: log the raw upstream payload when verbose level is high
      if (getLevel() >= 3) log(3, 'upstream', 'raw-upstream-payload', payload);

      const anthropicModel = conversion?.requestedModel ?? defaultModel;
      if (transformsEnabled()) {
        payload = await runResponsePipeline('anthropic.messages', 'anthropic', anthropicModel, !!activeToken, { modelOverrides: sessionModelOverrides }, payload);
        // Debug: log the payload after running response transforms
        if (getLevel() >= 3) log(3, 'upstream', 'transformed-upstream-payload', payload);
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
