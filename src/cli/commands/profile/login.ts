import readline from 'node:readline';

import { deviceAuth, testModels } from '../../../core/auth.js';
import { generateProfileId, type AuthProfile } from '../../../config/index.js';
import { AUTH_PROVIDERS, getProvider, saveAuthProfile, setActiveProfile } from './shared.js';

function askForProvider(): Promise<string> {
  return new Promise((resolve) => {
    console.log('\nSelect authentication provider:');
    console.log('================================\n');

    AUTH_PROVIDERS.forEach((provider, index) => {
      const ownerSuffix = provider.owner ? ` by ${provider.owner}` : '';
      console.log(`${index + 1}. ${provider.name}${ownerSuffix}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Choose provider (1-${AUTH_PROVIDERS.length}): `, (answer) => {
      rl.close();
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < AUTH_PROVIDERS.length) {
        resolve(AUTH_PROVIDERS[index].id);
      } else {
        console.log('Invalid selection, defaulting to VS Code provider');
        resolve('vscode');
      }
    });
  });
}

export async function login(providerId?: string): Promise<void> {
  try {
    const resolvedProviderId = providerId || (await askForProvider());
    const provider = getProvider(resolvedProviderId);
    if (!provider) {
      throw new Error(`Unknown provider: ${resolvedProviderId}`);
    }

    const { copilotToken, githubToken, user } = await deviceAuth(provider);

    console.log('\nTesting model access...');
    const models = await testModels(copilotToken);

    const profileId = generateProfileId(provider.id, user.login);
    const profile: AuthProfile = {
      id: profileId,
      token: copilotToken,
      githubToken,
      provider: provider.id,
      timestamp: Date.now(),
      models,
      user
    };

    saveAuthProfile(profileId, profile);
    setActiveProfile(profileId);

    console.log('\n✓ Authentication successful!');
    console.log(`  Provider: ${provider.name}`);
    console.log(`  User: ${user.name || user.login} (@${user.login})`);
    console.log(`  Profile ID: ${profileId}`);
    if (models.length > 0) {
      console.log(`  Working models: ${models.length}`);
    } else {
      console.log('  Working models: none detected');
    }
  } catch (error: any) {
    console.error('\n❌ Authentication failed:', error?.message || error);
    process.exit(1);
  }
}
