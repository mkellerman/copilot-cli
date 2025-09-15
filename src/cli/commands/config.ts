import { ConfigManager } from '../../core/config-manager.js';

export function get(key: string): void {
  const config = ConfigManager.getInstance();
  const value = config.get(key);
  
  if (value === undefined) {
    console.error(`Configuration key '${key}' not found`);
    process.exit(1);
  }
  
  console.log(value);
}

export function set(key: string, value: string): void {
  const config = ConfigManager.getInstance();
  
  try {
    config.set(key, value);
    console.log(`✓ Set ${key} = ${value}`);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

export function list(): void {
  const config = ConfigManager.getInstance();
  const settings = config.list();
  
  console.log('Current Configuration');
  console.log('====================');
  console.log(JSON.stringify(settings, null, 2));
}

export function reset(): void {
  const config = ConfigManager.getInstance();
  config.reset();
  console.log('✓ Configuration reset to defaults');
}