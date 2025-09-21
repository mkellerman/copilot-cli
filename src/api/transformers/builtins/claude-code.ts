import type { TransformerFactory } from '../types.js';

interface ClaudeCodeOptions {
  mode?: 'guarded' | 'off';
}

const factory: TransformerFactory = (options?: ClaudeCodeOptions) => {
  const mode = options?.mode ?? 'off';
  return {
    id: 'claude-code',
    applyRequest(ctx, payload) {
      if (mode === 'off') return;
      // Placeholder: log only
      ctx.log(2, 'xfm', `claude-code(request): mode=${mode}`);
      return;
    },
    applyResponse(ctx, json) {
      if (mode === 'off') return;
      ctx.log(2, 'xfm', `claude-code(response): mode=${mode}`);
      return;
    }
  };
};

export default factory;

