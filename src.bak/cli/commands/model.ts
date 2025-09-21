import readline from 'readline';
import { getActiveProfile, loadAuthProfiles, saveAuthProfile, type AuthProfile } from '../../config/index.js';
import { ConfigManager } from '../../core/config-manager.js';
import { getValidToken } from '../../core/auth.js';
import { getProvider } from '../../core/auth-providers.js';
import { ModelCatalog, type ModelCatalogEntry, type ModelValidationProgress } from '../../core/model-catalog.js';

const catalog = ModelCatalog.getInstance();

export async function list(): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const provider = getProvider(profile.provider);

  console.log(`\nUsing profile: ${id} (${profile.user.name || profile.user.login})`);
  console.log(`Provider: ${provider?.name || profile.provider}`);

  const entry = catalog.getEntry(id);

  if (!entry) {
    console.log('\n✗ No cached model data');
    console.log('Run: copilot-cli model refresh');
    return;
  }

  printCatalogSummary(entry);

  if (entry.models.length === 0) {
    console.log('\n✗ No working models recorded. Run: copilot-cli model refresh');
    return;
  }

  const config = ConfigManager.getInstance();
  const currentModel = config.get<string>('model.default') || entry.models[0];

  console.log('\nWorking Models:');
  console.log('===============\n');
  entry.models.forEach((modelId) => {
    const marker = modelId === currentModel ? '  ▶ ' : '    ';
    console.log(`${marker}${modelId}`);
  });

  console.log(`\nCurrent default: ${currentModel}`);
  if (entry.status === 'stale') {
    console.log('Cache status: ⚠ stale — refresh recommended');
  }
}

export async function refresh(): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const provider = getProvider(profile.provider);
  const token = await getValidToken();

  if (!token) {
    console.error('Error: Not authenticated or unable to refresh token');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }

  console.log(`\nUsing profile: ${id} (${profile.user.name || profile.user.login})`);
  console.log(`Provider: ${provider?.name || profile.provider}`);
  console.log('Refreshing model catalog with validation...');

  const progress = createProgressReporter();

  let entry: ModelCatalogEntry;
  try {
    entry = await catalog.refresh({
      profileId: id,
      token,
      verify: true,
      source: 'manual',
      onProgress: progress
    });
  } catch (error: any) {
    console.error(`\n✗ Catalog refresh failed: ${error?.message || error}`);
    process.exit(1);
  }

  persistProfileModels(id, profile, entry);

  const config = ConfigManager.getInstance();
  const currentModel = config.get<string>('model.default') || entry.models[0] || 'gpt-4';

  console.log('\nRefreshed Working Models:');
  console.log('=========================\n');
  entry.models.forEach((modelId) => {
    const marker = modelId === currentModel ? '  ▶ ' : '    ';
    console.log(`${marker}${modelId}`);
  });

  const { stats } = entry;
  console.log(`\nFound ${stats.working}/${stats.total} working models (validation ${stats.validated ? 'enabled' : 'skipped'})`);
  console.log(`Validation time: ${formatDuration(stats.durationMs)}`);
  if (entry.failedModels?.length) {
    console.log(`Failed models: ${entry.failedModels.join(', ')}`);
  }
}

export async function set(modelId?: string): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const token = await getValidToken();

  if (!token) {
    console.error('Error: Not authenticated or unable to refresh token');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }

  let entry = catalog.getEntry(id);

  if (!entry || entry.status !== 'ready') {
    console.log('Catalog is empty or stale — refreshing before selection...');
    entry = await catalog.refresh({
      profileId: id,
      token,
      verify: true,
      source: 'manual'
    });
    persistProfileModels(id, profile, entry);
  }

  if (entry.models.length === 0) {
    console.error('No working models available. Run: copilot-cli model refresh');
    process.exit(1);
  }

  let selectedModel = modelId;

  if (!selectedModel) {
    console.log('\nSelect default model:');
    console.log('====================\n');

    entry.models.forEach((model, index) => {
      console.log(`${index + 1}. ${model}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    selectedModel = await new Promise<string>((resolve) => {
      rl.question('\nChoose model (1-' + entry!.models.length + '): ', (answer) => {
        rl.close();
        const index = parseInt(answer, 10) - 1;
        if (index >= 0 && index < entry!.models.length) {
          resolve(entry!.models[index]);
        } else {
          console.error('Invalid selection');
          process.exit(1);
        }
      });
    });
  }

  if (!entry.models.includes(selectedModel)) {
    console.error(`Model '${selectedModel}' is not available`);
    console.log('Available models:', entry.models.join(', '));
    process.exit(1);
  }

  const config = ConfigManager.getInstance();
  await config.set('model.default', selectedModel);

  console.log(`✓ Default model set to: ${selectedModel}`);
}

export async function info(): Promise<void> {
  const { id, profile } = requireActiveProfile();
  const config = ConfigManager.getInstance();
  const currentModel = config.get<string>('model.default') || 'gpt-4';

  let entry = catalog.getEntry(id);

  if (!entry) {
    const token = await getValidToken();
    if (token) {
      try {
        entry = await catalog.refresh({
          profileId: id,
          token,
          verify: true,
          source: 'manual'
        });
        persistProfileModels(id, profile, entry);
      } catch {
        // ignore refresh errors for info command
      }
    }
  }

  console.log('\nModel Configuration:');
  console.log('===================');
  console.log(`Default model: ${currentModel}`);

  if (entry) {
    printCatalogSummary(entry);
    if (!entry.models.includes(currentModel)) {
      if (entry.models.length > 0) {
        console.log(`\n⚠ '${currentModel}' is not in the working model list.`);
        console.log(`Available models: ${entry.models.join(', ')}`);
      } else {
        console.log('\n⚠ No working models recorded. Run: copilot-cli model refresh');
      }
    } else {
      console.log('\n✓ Default model is available');
    }
  } else {
    console.log('\nNo catalog data available. Run: copilot-cli model refresh');
  }
}

function requireActiveProfile(): { id: string; profile: AuthProfile } {
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();

  if (!activeProfileId || !profiles[activeProfileId]) {
    console.error('Error: Not authenticated');
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }

  return { id: activeProfileId, profile: profiles[activeProfileId] };
}

function persistProfileModels(id: string, profile: AuthProfile, entry: ModelCatalogEntry): void {
  saveAuthProfile(id, {
    ...profile,
    models: entry.models,
    timestamp: entry.updatedAt
  });
}

function printCatalogSummary(entry: ModelCatalogEntry): void {
  const statusIcon = entry.status === 'ready' ? '✓' : entry.status === 'stale' ? '⚠' : '✗';
  const statusLabel = entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
  console.log(`\nCatalog status: ${statusIcon} ${statusLabel}`);
  console.log(`Last updated: ${formatRelative(entry.ageMs)} (${new Date(entry.updatedAt).toLocaleString()})`);
  console.log(`Models cached: ${entry.models.length}`);

  const stats = entry.stats;
  if (stats.total > 0) {
    console.log(`Validated ${stats.total} models (${stats.working} ✓ / ${stats.failed} ✗) in ${formatDuration(stats.durationMs)}`);
  }
  if (entry.status === 'error' && entry.error) {
    console.log(`Last error: ${entry.error}`);
  }
}

function createProgressReporter() {
  let lastUpdate = Date.now();
  return (progress: ModelValidationProgress) => {
    const now = Date.now();
    if (now - lastUpdate < 50 && progress.index !== progress.total) {
      return;
    }
    lastUpdate = now;
    const marker = progress.success ? '✓' : '✗';
    console.log(`${marker} [${progress.index}/${progress.total}] ${progress.modelId}`);
  };
}

function formatRelative(ms: number): string {
  if (ms < 5_000) {
    return 'just now';
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return `${Math.round(ms / 1_000)} seconds ago`;
  }
  if (minutes === 1) {
    return '1 minute ago';
  }
  if (minutes < 60) {
    return `${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 1 && minutes % 60 === 0) {
    return '1 hour ago';
  }
  if (hours < 24) {
    const remMinutes = minutes % 60;
    return remMinutes === 0 ? `${hours} hours ago` : `${hours}h ${remMinutes}m ago`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days} days ago` : `${days}d ${remHours}h ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}
