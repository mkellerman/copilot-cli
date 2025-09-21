import { ConfigManager } from '../../../core/config-manager.js';
import { getValidToken } from '../../../core/auth.js';
import { getProvider, readProfiles } from './shared.js';

interface StatusOptions {
  json?: boolean;
}

export async function showStatus(options: StatusOptions = {}): Promise<void> {
  const token = await getValidToken();
  const { profiles, activeId } = readProfiles();
  const config = ConfigManager.getInstance();
  const defaultModel = config.get<string>('model.default') || 'gpt-4';

  if (token && activeId && profiles[activeId]) {
    const profile = profiles[activeId];
    const provider = getProvider(profile.provider);
    const otherProfiles = Object.keys(profiles).filter((id) => id !== activeId);

    if (options.json) {
      const output = {
        authentication: {
          status: 'active' as const,
          activeProfile: activeId,
          user: {
            login: profile.user.login,
            name: profile.user.name || null
          },
          provider: provider?.id || profile.provider,
          token: `${token.substring(0, 10)}...${token.slice(-4)}`,
          models: profile.models || [],
          otherProfiles
        },
        model: {
          default: defaultModel
        }
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log('\nGitHub Copilot Authentication Status');
    console.log('====================================');
    console.log('✓ Authenticated');
    console.log(`  Active profile: ${activeId}`);
    console.log(`  User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
    if (provider) {
      console.log(`  Provider: ${provider.name}`);
    }
    console.log(`  Token: ${token.substring(0, 10)}...${token.slice(-4)}`);
    console.log(`  Default model: ${defaultModel}`);
    if (profile.models?.length) {
      console.log(`  Cached models: ${profile.models.length}`);
    }
    if (otherProfiles.length > 0) {
      console.log(`\n  Other profiles: ${otherProfiles.length}`);
      otherProfiles.forEach((id) => {
        const p = profiles[id];
        console.log(`    - ${id} (${p.user.name || p.user.login})`);
      });
      console.log('\n  Use "copilot profile switch <profileId>" to change active profile.');
    }
    console.log();
    return;
  }

  if (options.json) {
    const output = {
      authentication: {
        status: 'inactive' as const
      },
      model: {
        default: defaultModel
      }
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('\nGitHub Copilot Authentication Status');
  console.log('====================================');
  console.log('✗ Not authenticated');
  console.log('Run: copilot profile login\n');
}
