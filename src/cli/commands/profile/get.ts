import { ConfigManager } from '../../../core/config-manager.js';
import { CONFIG_PATHS, type ConfigPath } from '../../../config/schema.js';

const manager = ConfigManager.getInstance();

export async function getConfigValue(key: string): Promise<void> {
  const path = resolvePath(key);
  const value = manager.get(path);
  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

function resolvePath(key: string): ConfigPath {
  if (CONFIG_PATHS.includes(key as ConfigPath)) {
    return key as ConfigPath;
  }
  throw new Error(`Unknown configuration key: ${key}`);
}
