import { startApiServer } from '../../api/server.js';
import { ConfigManager } from '../../core/config-manager.js';
import { ModelCatalog } from '../../core/model-catalog.js';
import { resolveProfileIdForToken as resolveProfileIdForTokenFromCatalog } from '../../core/model-selector.js';
import { loadAuthInfo, loadToken, DEFAULT_PORT, DEFAULT_OSS_PORT } from '../../config/index.js';

export interface ApiCommandOptions {
  port?: number;
  token?: string;
  model?: string;
  silent?: boolean;
  oss?: boolean;
}

export async function runApiCommand(options: ApiCommandOptions): Promise<void> {
  const config = ConfigManager.getInstance();

  const ossMode = options.oss ?? false;
  const configuredPort = config.get<number>('api.port');
  const defaultPort = ossMode ? DEFAULT_OSS_PORT : DEFAULT_PORT;
  const port = options.port ?? (ossMode ? defaultPort : configuredPort ?? defaultPort);
  const configuredHost = config.get<string>('api.host');
  const host = !configuredHost || configuredHost === 'localhost' ? '127.0.0.1' : configuredHost;
  const silent = options.silent ?? false;

  const explicitToken = options.token?.trim();
  const authInfo = loadAuthInfo();
  const storedToken = authInfo?.token || loadToken();
  const token = explicitToken || storedToken;

  const sessionModelRaw = options.model?.trim();
  if (sessionModelRaw && sessionModelRaw.length === 0) {
    throw new Error('Specify a non-empty model id when using --model.');
  }

  if (!token) {
    throw new Error('No authentication token found. Run: copilot profile login');
  }

  let sessionModelResolved: string | undefined;
  if (sessionModelRaw) {
    const profileId = resolveProfileIdForTokenFromCatalog(token);
    if (!profileId) {
      throw new Error('Unable to resolve active profile for the provided token; cannot validate --model. Run: copilot profile login');
    }

    const catalog = ModelCatalog.getInstance();
    let entry = catalog.getEntry(profileId);
    if (!entry || entry.models.length === 0) {
      try {
        entry = await catalog.ensureFreshProfile(profileId, token, { source: 'manual', verify: false });
      } catch (error: any) {
        throw new Error(`Failed to refresh model catalog for profile ${profileId}: ${error?.message || error}`);
      }
    }

    const candidates = entry?.rawModels ?? [];
    const catalogModels = entry?.models ?? [];
    const requestedLower = sessionModelRaw.toLowerCase();
    const canonical =
      candidates.find((model) => model.id?.toLowerCase() === requestedLower)?.id
      ?? catalogModels.find((id) => id.toLowerCase() === requestedLower);

    if (!canonical) {
      throw new Error(`Model "${sessionModelRaw}" is not available for the active profile. Run: copilot profile refresh`);
    }

    if (canonical !== sessionModelRaw && !silent) {
      console.log(`Using canonical model id "${canonical}" (requested "${sessionModelRaw}").`);
    }
    sessionModelResolved = canonical;
  }

  if (!silent) {
    const label = ossMode ? 'Ollama-compatible API server' : 'API server';
    console.log(`Starting ${label} on http://${host}:${port}`);
  }

  startApiServer(port, token, host, {
    silent,
    schema: ossMode ? 'ollama' : 'openai',
    defaultModelOverride: sessionModelResolved
  });
}
