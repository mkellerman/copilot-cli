import type { AppConfig } from '../../config/schema.js';

export type TransformerRoute = 'openai.chat.completions' | 'anthropic.messages';
export type TransformerProvider = 'openai' | 'anthropic';

export interface TransformerContext {
  route: TransformerRoute;
  provider: TransformerProvider;
  model?: string;
  tokenPresent: boolean;
  config: AppConfig;
  session: {
    modelOverrides?: Map<string, string>;
  };
  log: (level: number, tag: string, message: string, extra?: any) => void;
}

export interface RequestTransformResult {
  payload?: any;
  headers?: Record<string, string>;
}

export interface ResponseTransformResult {
  json?: any;
}

export interface TransformerModule {
  id: string;
  applyRequest?: (ctx: TransformerContext, payload: any) => Promise<RequestTransformResult | void> | (RequestTransformResult | void);
  applyResponse?: (ctx: TransformerContext, json: any) => Promise<ResponseTransformResult | void> | (ResponseTransformResult | void);
}

export interface TransformerFactory {
  (options?: any): TransformerModule;
}

