import { ConfigManager } from '../../../core/config-manager.js';
import { CONFIG_PATHS, type ConfigPath } from '../../../config/schema.js';

const manager = ConfigManager.getInstance();

export async function setConfigValue(key: string, value: string): Promise<void> {
  const path = resolvePath(key);
  await manager.set(path, value);
  console.log(`✓ Set ${key}`);
}

function resolvePath(key: string): ConfigPath {
  if (CONFIG_PATHS.includes(key as ConfigPath)) {
    return key as ConfigPath;
  }
  throw new Error(`Unknown configuration key: ${key}`);
}
