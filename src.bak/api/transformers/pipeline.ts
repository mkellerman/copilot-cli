import { ConfigManager } from '../../core/config-manager.js';
import { getLevel, log as coreLog } from '../../core/logger.js';
import type { TransformerContext, TransformerFactory, TransformerModule, TransformerRoute } from './types.js';

type RegistryEntry = { module: string; options?: any };

function log(level: number, tag: string, msg: string, extra?: any) {
  coreLog(level, tag, msg, extra);
}

function createContext(route: TransformerRoute, provider: 'openai' | 'anthropic', model: string | undefined, tokenPresent: boolean, session: TransformerContext['session']): TransformerContext {
  const config = ConfigManager.getInstance().list();
  return {
    route,
    provider,
    model,
    tokenPresent,
    config,
    session,
    log
  };
}

export function transformsEnabled(): boolean {
  try {
    const cfg = ConfigManager.getInstance().list() as any;
    return !!cfg.transforms?.enabled;
  } catch {
    return false;
  }
}

function getPipelineIds(route: TransformerRoute): string[] {
  try {
    const cfg = ConfigManager.getInstance().list() as any;
    const key = route === 'openai.chat.completions' ? 'openai.chat.completions' : 'anthropic.messages';
    return Array.isArray(cfg.transforms?.pipelines?.[key]) ? cfg.transforms.pipelines[key] as string[] : [];
  } catch {
    return [];
  }
}

function getRegistry(): Record<string, RegistryEntry> {
  try {
    const cfg = ConfigManager.getInstance().list() as any;
    return (cfg.transforms?.registry ?? {}) as Record<string, RegistryEntry>;
  } catch {
    return {};
  }
}

async function builtInFactory(name: string): Promise<TransformerFactory | undefined> {
  switch (name) {
    case 'model-router':
      return (await import('./builtins/model-router.js')).default as unknown as TransformerFactory;
    case 'claude-code':
      return (await import('./builtins/claude-code.js')).default as unknown as TransformerFactory;
    default:
      return undefined;
  }
}

async function loadFactory(entry: RegistryEntry): Promise<TransformerFactory | undefined> {
  const mod = entry.module || '';
  if (mod.startsWith('built-in:')) {
    const name = mod.slice('built-in:'.length);
    return await builtInFactory(name);
  }
  if (mod.startsWith('file:')) {
    const cfg = ConfigManager.getInstance().list() as any;
    if (!cfg.transforms?.allowScripts) {
      log(1, 'xfm', `skipping script transformer (allowScripts=false): ${mod}`);
      return undefined;
    }
    const path = mod.slice('file:'.length);
    try {
      const dyn = (await import(path)) as any;
      return (dyn.default ?? dyn) as TransformerFactory;
    } catch (error) {
      log(1, 'xfm', `failed to load transformer module: ${mod}`, { error: (error as any)?.message || String(error) });
      return undefined;
    }
  }
  return undefined;
}

async function buildPipeline(route: TransformerRoute): Promise<TransformerModule[]> {
  const ids = getPipelineIds(route);
  if (!ids.length) return [];
  const registry = getRegistry();
  const out: TransformerModule[] = [];
  for (const id of ids) {
    const entry = registry[id];
    if (!entry) {
      log(1, 'xfm', `unknown transformer id in pipeline: ${id}`);
      continue;
    }
    const factory = await loadFactory(entry);
    if (!factory) continue;
    try {
      out.push(factory(entry.options));
    } catch (error) {
      log(1, 'xfm', `failed to instantiate transformer: ${id}`, { error: (error as any)?.message || String(error) });
    }
  }
  return out;
}

export async function runRequestPipeline(
  route: TransformerRoute,
  provider: 'openai' | 'anthropic',
  model: string | undefined,
  tokenPresent: boolean,
  session: TransformerContext['session'],
  payload: any
): Promise<{ payload: any; headers?: Record<string, string> }>
{
  if (!transformsEnabled()) return { payload };
  const modules = await buildPipeline(route);
  if (!modules.length) return { payload };
  const ctx = createContext(route, provider, model, tokenPresent, session);
  let current = payload;
  let headers: Record<string, string> | undefined;
  for (const m of modules) {
    if (!m.applyRequest) continue;
    try {
      const res = await m.applyRequest(ctx, current);
      if (res?.payload !== undefined) current = res.payload;
      if (res?.headers) headers = { ...(headers ?? {}), ...res.headers };
    } catch (error) {
      log(1, 'xfm', `request transformer error: ${m.id}`, { error: (error as any)?.message || String(error) });
    }
  }
  return { payload: current, headers };
}

export async function runResponsePipeline(
  route: TransformerRoute,
  provider: 'openai' | 'anthropic',
  model: string | undefined,
  tokenPresent: boolean,
  session: TransformerContext['session'],
  json: any
): Promise<any> {
  if (!transformsEnabled()) return json;
  const modules = await buildPipeline(route);
  if (!modules.length) return json;
  const ctx = createContext(route, provider, model, tokenPresent, session);
  let current = json;
  for (const m of modules) {
    if (!m.applyResponse) continue;
    try {
      const res = await m.applyResponse(ctx, current);
      if (res?.json !== undefined) current = res.json;
    } catch (error) {
      log(1, 'xfm', `response transformer error: ${m.id}`, { error: (error as any)?.message || String(error) });
    }
  }
  return current;
}
