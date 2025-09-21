import type { TransformerFactory } from '../types.js';

interface ModelRouterOptions {
  map?: Record<string, string>;
  prefixRules?: Array<{ startsWith: string; to: string }>;
}

const factory: TransformerFactory = (options?: ModelRouterOptions) => {
  const map = options?.map ?? {};
  const prefixRules = options?.prefixRules ?? [];
  return {
    id: 'model-router',
    applyRequest(ctx, payload) {
      try {
        const original = payload?.model as string | undefined;
        if (!original) return;
        let next = map[original];
        if (!next) {
          for (const rule of prefixRules) {
            if (original.startsWith(rule.startsWith)) {
              next = rule.to;
              break;
            }
          }
        }
        if (next && next !== original) {
          const mutated = { ...payload, model: next };
          ctx.log(2, 'xfm', `model-router: ${original} -> ${next}`);
          return { payload: mutated };
        }
      } catch {
        // ignore
      }
      return;
    }
  };
};

export default factory;

