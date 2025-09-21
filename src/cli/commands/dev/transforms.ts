import { ConfigManager } from '../../../core/config-manager.js';

const manager = ConfigManager.getInstance();

export async function showTransformsStatus(): Promise<void> {
  const { transforms } = manager.list();
  console.log('Transforms configuration:');
  console.log(JSON.stringify(transforms, null, 2));
}

export async function setTransformsEnabled(enabled: boolean): Promise<void> {
  await manager.set('transforms.enabled', enabled);
  console.log(`✓ Transforms ${enabled ? 'enabled' : 'disabled'}`);
}

export async function setTransformsAllowScripts(allow: boolean): Promise<void> {
  await manager.set('transforms.allowScripts', allow);
  console.log(`✓ transform scripts ${allow ? 'allowed' : 'blocked'}`);
}
