import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_BASE_URL = 'https://api.githubcopilot.com';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_USER_AGENT = 'copilot-cli/1.0';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

export interface CopilotClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
  telemetry?: {
    onRetry?: (info: { attempt: number; path: string; method: string; status?: number; error?: unknown }) => void;
  };
}

export interface CopilotRequestOptions {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CopilotModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface CopilotChatCompletionRequest {
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

export class CopilotHttpClient {
  private static instance: CopilotHttpClient | undefined;

  static getInstance(): CopilotHttpClient {
    if (!CopilotHttpClient.instance) {
      CopilotHttpClient.instance = new CopilotHttpClient();
    }
    return CopilotHttpClient.instance;
  }

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly telemetry?: CopilotClientOptions['telemetry'];

  constructor(options: CopilotClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.telemetry = options.telemetry;
  }

  async listModels(token: string): Promise<CopilotModel[]> {
    const response = await this.request({ path: '/models', token });

    if (!response.ok) {
      const errorPayload = await this.safeReadText(response);
      throw new Error(`Failed to list models (status ${response.status})${errorPayload ? `: ${errorPayload}` : ''}`);
    }

    const payload = await this.safeReadJson<any>(response);
    const models: CopilotModel[] = (payload?.data ?? []).map((entry: any) => ({
      id: entry.id,
      object: entry.object ?? 'model',
      created: entry.created ?? Math.floor(Date.now() / 1000),
      owned_by: entry.owned_by ?? 'github-copilot'
    }));

    return models;
  }

  async postChatCompletion(
    token: string,
    payload: CopilotChatCompletionRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<FetchResponse> {
    return this.request({
      path: '/chat/completions',
      method: 'POST',
      token,
      body: payload,
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal
    });
  }

  async verifyModel(
    token: string,
    modelId: string,
    timeoutMsOrOptions?: number | { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<boolean> {
    const options = typeof timeoutMsOrOptions === 'number'
      ? { timeoutMs: timeoutMsOrOptions }
      : (timeoutMsOrOptions ?? {});

    try {
      const response = await this.request({
        path: '/chat/completions',
        method: 'POST',
        token,
        body: {
          messages: [{ role: 'user', content: '2+2' }],
          model: modelId,
          max_tokens: 5,
          temperature: 0
        },
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: options.timeoutMs ?? 6000,
        signal: options.signal
      });

      if (!response.ok) {
        await response.body?.cancel?.();
        return false;
      }

      await response.body?.cancel?.();
      return true;
    } catch {
      return false;
    }
  }

  private async request(options: CopilotRequestOptions): Promise<FetchResponse> {
    const { path, method = 'GET', body, headers, token, timeoutMs, signal } = options;
    const url = new URL(path, this.baseUrl);

    const defaultHeaders: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Editor-Version': 'vscode/1.85.0',
      'Editor-Plugin-Version': 'copilot-chat/0.11.0',
      'Openai-Organization': 'github-copilot'
    };

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        defaultHeaders[key] = value;
      }
    }

    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    let requestBody: any;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        requestBody = body;
      } else {
        requestBody = JSON.stringify(body);
        if (!defaultHeaders['Content-Type']) {
          defaultHeaders['Content-Type'] = 'application/json';
        }
      }
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      let abortedByCaller = false;

      const abortHandler = () => {
        abortedByCaller = true;
        controller.abort(signal?.reason ?? new Error('Request aborted'));
      };

      if (signal) {
        if (signal.aborted) {
          abortHandler();
        } else {
          signal.addEventListener('abort', abortHandler, { once: true });
        }
      }

      const timeout = setTimeout(() => {
        controller.abort(new Error('Request timed out'));
      }, timeoutMs ?? this.timeoutMs) as NodeJS.Timeout;
      timeout.unref?.();

      try {
        const response = await fetch(url, {
          method,
          headers: defaultHeaders,
          body: requestBody,
          signal: controller.signal
        });

        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        clearTimeout(timeout);

        if (this.shouldRetry(response) && attempt < this.maxRetries) {
          await response.body?.cancel?.();
          this.telemetry?.onRetry?.({ attempt, path: url.pathname, method, status: response.status });
          await delay(this.backoff(attempt));
          continue;
        }

        return response;
      } catch (error) {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        clearTimeout(timeout);

        if (abortedByCaller) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          this.telemetry?.onRetry?.({ attempt, path: url.pathname, method, error });
          await delay(this.backoff(attempt));
          continue;
        }

        if (error instanceof Error) {
          throw error;
        }

        throw new Error('Unknown error during Copilot request');
      }
    }

    throw new Error('Exceeded maximum retries for Copilot request');
  }

  private shouldRetry(response: FetchResponse): boolean {
    const retryable = response.status >= 500 || response.status === 429 || response.status === 408 || response.status === 425;
    return retryable;
  }

  private backoff(attempt: number): number {
    const base = 250 * 2 ** attempt;
    return Math.min(1500, base);
  }

  private async safeReadText(response: FetchResponse): Promise<string | null> {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }

  private async safeReadJson<T>(response: FetchResponse): Promise<T | null> {
    try {
      return (await response.clone().json()) as T;
    } catch {
      return null;
    }
  }
}
