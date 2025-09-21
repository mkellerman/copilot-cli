import { ConfigManager } from '../../core/config-manager.js';
import { ModelCatalog } from '../../core/model-catalog.js';
import type { ModelCatalogEntry } from '../../core/model-catalog.js';
import { testModels } from '../../core/auth.js';
import { resolveProfileIdForToken } from '../routes/auth.js';

export async function renderAvailableModelsText(token?: string): Promise<string> {
  const lines: string[] = [];

  if (!token) {
    lines.push('No token available — showing local info only.');
    lines.push('Authenticate with: copilot profile login');
    return lines.join('\n');
  }

  const catalog = ModelCatalog.getInstance();
  const profileId = resolveProfileIdForToken(token);
  let entry: ModelCatalogEntry | undefined = profileId ? catalog.getEntry(profileId) : undefined;
  let models: string[] = entry && entry.models.length > 0 ? entry.models : [];

  if (models.length === 0) {
    try {
      const ids = await testModels(token, profileId);
      models = ids;
    } catch (error: any) {
      lines.push(`✗ Failed to fetch models: ${error?.message || error}`);
    }
  }

  const config = ConfigManager.getInstance();
  const currentModel = config.get<string>('model.default') || models[0] || 'gpt-4';

  if (models.length === 0) {
    lines.push('No working models discovered.');
    lines.push('Run: copilot profile refresh');
  } else {
    lines.push('Working Models:');
    models.forEach((m) => {
      const marker = m === currentModel ? '  ▶ ' : '    ';
      lines.push(`${marker}${m}`);
    });
    lines.push(`\nCurrent default: ${currentModel}`);
  }

  return lines.join('\n');
}
