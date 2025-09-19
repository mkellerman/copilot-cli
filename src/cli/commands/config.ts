import { ConfigManager, type ConfigIssue } from '../../core/config-manager.js';
import { CONFIG_PATHS, type ConfigPath } from '../../config/schema.js';

const manager = ConfigManager.getInstance();

export async function get(key: string): Promise<void> {
  const path = resolvePath(key);
  const value = manager.get(path);
  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
}

export async function set(key: string, value: string): Promise<void> {
  const path = resolvePath(key);
  await manager.set(path, value);
  console.log(`✓ Set ${key}`);
}

export async function list(): Promise<void> {
  console.log(JSON.stringify(manager.list(), null, 2));
}

export async function reset(): Promise<void> {
  await manager.reset();
  console.log('✓ Configuration reset to defaults');
}

export async function doctor(): Promise<void> {
  const report = manager.doctor();

  if (report.ok) {
    console.log('✓ Configuration is valid');
  } else {
    console.log('✗ Configuration issues detected:');
    report.issues.forEach((issue) => printIssue(issue));
  }

  console.log('\nEffective configuration:');
  console.log(JSON.stringify(report.config, null, 2));
}

function resolvePath(key: string): ConfigPath {
  if (CONFIG_PATHS.includes(key as ConfigPath)) {
    return key as ConfigPath;
  }
  throw new Error(`Unknown configuration key: ${key}`);
}

function printIssue(issue: ConfigIssue): void {
  const location = issue.path ? `${issue.path}` : '*';
  const valueHint = issue.value !== undefined ? ` (value: ${issue.value})` : '';
  console.log(` - [${issue.source}] ${location}: ${issue.message}${valueHint}`);
}

