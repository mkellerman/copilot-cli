import https from 'https';
import readline from 'readline';
import { deviceAuth, getCopilotToken, testModels, getValidToken, listModels } from '../../core/auth.js';
import { saveToken, loadToken, deleteToken, saveAuthInfo, loadAuthInfo, loadAuthProfiles, saveAuthProfile, getActiveProfile, setActiveProfile, generateProfileId, deleteAuthProfile, AuthProfile } from '../../config/index.js';
import { AUTH_PROVIDERS, getProvider } from '../../core/auth-providers.js';
import { CopilotHttpClient } from '../../core/copilot-client.js';
import fs from 'fs';

function askForProvider(): Promise<string> {
  return new Promise((resolve) => {
    console.log('\nSelect authentication provider:');
    console.log('================================\n');
    
    AUTH_PROVIDERS.forEach((provider, index) => {
      console.log(`${index + 1}. ${provider.name} ${provider.owner ? `by ${provider.owner}` : ''}`);
      // console.log(`    `);
      // console.log(`    Permissions: ${provider.scopes || 'minimal'}\n`);
    });
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Choose provider (1-' + AUTH_PROVIDERS.length + '): ', (answer) => {
      rl.close();
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < AUTH_PROVIDERS.length) {
        resolve(AUTH_PROVIDERS[index].id);
      } else {
        console.log('Invalid selection, using default (VS Code)');
        resolve('vscode');
      }
    });
  });
}

export async function login(providerId?: string): Promise<void> {
  try {
    // If no provider specified, ask user
    if (!providerId) {
      providerId = await askForProvider();
    }
    
    const provider = getProvider(providerId);
    if (!provider) {
      console.error('Invalid provider');
      process.exit(1);
    }
    
    const { copilotToken, githubToken, user } = await deviceAuth(provider);
    
    // Test what models are available
    console.log('\nTesting model access...');
    const models = await testModels(copilotToken);
    
    // Generate profile ID
    const profileId = generateProfileId(provider.id, user.login);
    
    // Save auth profile
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
      console.log(`  Available models: ${models.length} models`);
    } else {
      console.log('  Models: Unable to retrieve (will use defaults)');
    }
  } catch (error: any) {
    console.error('\n❌ Authentication failed:', error.message);
    process.exit(1);
  }
}

export function logout(profileId?: string): void {
  if (profileId) {
    // Logout specific profile
    if (deleteAuthProfile(profileId)) {
      console.log(`✓ Successfully logged out profile: ${profileId}`);
      const activeProfile = getActiveProfile();
      if (activeProfile) {
        console.log(`Active profile switched to: ${activeProfile}`);
      } else {
        console.log('No remaining profiles. Please run: copilot-cli auth login');
      }
    } else {
      console.log(`Profile not found: ${profileId}`);
    }
  } else {
    // Logout current profile
    const activeProfile = getActiveProfile();
    if (activeProfile) {
      if (deleteAuthProfile(activeProfile)) {
        console.log(`✓ Successfully logged out profile: ${activeProfile}`);
        const newActiveProfile = getActiveProfile();
        if (newActiveProfile) {
          console.log(`Active profile switched to: ${newActiveProfile}`);
        } else {
          console.log('No remaining profiles. Please run: copilot-cli auth login');
        }
      } else {
        console.log('Failed to logout');
      }
    } else {
      // Fallback to old auth system
      if (deleteToken()) {
        console.log('✓ Successfully logged out');
      } else {
        console.log('No authentication found');
      }
    }
  }
}

async function validateToken(token: string): Promise<boolean> {
  const client = CopilotHttpClient.getInstance();
  return client.verifyModel(token, 'gpt-4');
}

export async function list(): Promise<void> {
  const profiles = loadAuthProfiles();
  const activeProfileId = getActiveProfile();
  
  console.log('\nAuthentication Profiles');
  console.log('=======================\n');
  
  if (Object.keys(profiles).length === 0) {
    console.log('No authentication profiles found.');
    console.log('Run: copilot-cli auth login\n');
    return;
  }
  
  Object.entries(profiles).forEach(([id, profile]) => {
    const isActive = id === activeProfileId;
    const marker = isActive ? '▶ ' : '  ';
    const provider = getProvider(profile.provider);
    
    console.log(`${marker}${id}`);
    console.log(`    User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
    console.log(`    Provider: ${provider?.name || profile.provider}`);
    
    if (profile.models && profile.models.length > 0) {
      console.log(`    Models: ${profile.models.length} available`);
    }
    
    const age = Date.now() - profile.timestamp;
    const hours = Math.floor(age / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) {
      console.log(`    Age: ${days} day${days > 1 ? 's' : ''}`);
    } else {
      console.log(`    Age: ${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    console.log();
  });
  
  if (!activeProfileId) {
    console.log('No active profile set. Use: copilot-cli auth switch <profile>');
  }
}

export function switchProfile(profileId: string): void {
  const profiles = loadAuthProfiles();
  
  if (!profiles[profileId]) {
    console.error(`Profile not found: ${profileId}`);
    console.log('\nAvailable profiles:');
    Object.keys(profiles).forEach(id => {
      const profile = profiles[id];
      console.log(`  ${id} (${profile.user.name || profile.user.login})`);
    });
    process.exit(1);
  }
  
  setActiveProfile(profileId);
  const profile = profiles[profileId];
  console.log(`✓ Switched to profile: ${profileId}`);
  console.log(`  User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
}

export async function status(options: { json?: boolean; verbose?: boolean } = {}): Promise<void> {
  const token = await getValidToken();
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  
  if (token && activeProfileId && profiles[activeProfileId]) {
    const profile = profiles[activeProfileId];
    if (options.json) {
      const provider = getProvider(profile.provider);
      const otherProfiles = Object.keys(profiles).filter(id => id !== activeProfileId);
      const output = {
        authentication: {
          status: 'active' as const,
          activeProfile: activeProfileId,
          user: {
            login: profile.user.login,
            name: profile.user.name || null
          },
          provider: provider?.id || profile.provider,
          token: `${token.substring(0, 10)}...${token.slice(-4)}`,
          models: profile.models || [],
          otherProfiles
        }
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('\nGitHub Copilot Authentication Status');
      console.log('====================================');
      console.log('✓ Authenticated');
      console.log(`  Active Profile: ${activeProfileId}`);
      console.log(`  User: ${profile.user.name || profile.user.login} (@${profile.user.login})`);
      console.log(`  Token: ${token.substring(0, 10)}...${token.slice(-4)}`);
      
      const provider = getProvider(profile.provider);
      if (provider) {
        console.log(`  Provider: ${provider.name}`);
      }
      if (profile.models && profile.models.length > 0) {
        console.log(`  Models: ${profile.models.length} available`);
      }
      const age = Date.now() - profile.timestamp;
      const hours = Math.floor(age / (1000 * 60 * 60));
      const days = Math.floor(hours / 24);
      if (days > 0) {
        console.log(`  Age: ${days} day${days > 1 ? 's' : ''}`);
      } else {
        console.log(`  Age: ${hours} hour${hours !== 1 ? 's' : ''}`);
      }
      
      // Show other available profiles
      const otherProfiles = Object.keys(profiles).filter(id => id !== activeProfileId);
      if (otherProfiles.length > 0) {
        console.log(`\n  Other profiles: ${otherProfiles.length}`);
        otherProfiles.forEach(id => {
          const p = profiles[id];
          console.log(`    - ${id} (${p.user.name || p.user.login})`);
        });
        console.log(`\n  Use 'copilot-cli auth switch <profile>' to change active profile`);
      }
      console.log();
    }
  } else {
    if (options.json) {
      const output = {
        authentication: {
          status: 'inactive' as const
        }
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log('\nGitHub Copilot Authentication Status');
      console.log('====================================');
      console.log('✗ Not authenticated');
      console.log('Run: copilot-cli auth login\n');
    }
    // Exit 0 for status reporting; non-zero reserved for operational failures
  }
}

export async function refresh(): Promise<void> {
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  if (!activeProfileId || !profiles[activeProfileId]) {
    console.error('No active profile found. Please login first.');
    console.error('Run: copilot-cli auth login\n');
    process.exit(1);
  }
  
  const profile = profiles[activeProfileId];
  
  try {
    console.log(`Refreshing token for profile: ${activeProfileId}...`);
    // Always get a fresh Copilot token from the GitHub token
    const newToken = await getCopilotToken(profile.githubToken);
    
    // Update profile with new token
    saveAuthProfile(activeProfileId, {
      ...profile,
      token: newToken,
      timestamp: Date.now()
    });
    
    console.log('✓ Token refreshed successfully');
  } catch (error: any) {
    console.error('Failed to refresh token:', error.message);
    console.error('Run: copilot-cli auth login');
    process.exit(1);
  }
}

type InventoryArgs = { providers?: string; output?: string };

export async function inventory(args: InventoryArgs): Promise<void> {
  // Determine provider list
  let providers = AUTH_PROVIDERS;
  if (args.providers) {
    const ids = args.providers.split(',').map(s => s.trim()).filter(Boolean);
    providers = AUTH_PROVIDERS.filter(p => ids.includes(p.id));
    if (providers.length === 0) {
      console.error('No matching providers for ids:', ids.join(', '));
      process.exit(1);
    }
  }

  console.log(`\nStarting inventory across ${providers.length} providers...`);

  const rows: Array<{ providerId: string; providerName: string; clientId: string; userLogin: string; userName: string | null; modelId: string }>=[];

  for (const provider of providers) {
    console.log(`\n=== Provider: ${provider.name} (${provider.id}) ===`);
    try {
      const { copilotToken, user } = await deviceAuth(provider);
      console.log(`Authenticated as ${user.name || user.login} (@${user.login})`);

      const models = await listModels(copilotToken);
      if (!models || models.length === 0) {
        console.log('No models returned');
      }
      for (const m of models) {
        rows.push({
          providerId: provider.id,
          providerName: provider.name,
          clientId: provider.clientId,
          userLogin: user.login,
          userName: user.name,
          modelId: m.id,
        });
      }
    } catch (e: any) {
      console.log(`Provider failed: ${e.message || e}`);
    }
  }

  // Build CSV
  const header = ['provider_id','provider_name','client_id','user_login','user_name','model_id'];
  const csvLines = [header.join(',')];
  const csvEscape = (s: string) => {
    const needsQuotes = /[",\r\n]/.test(s);
    const doubled = s.replace(/"/g, '""');
    return needsQuotes ? '"' + doubled + '"' : doubled;
  };
  for (const r of rows) {
    const vals = [r.providerId, r.providerName, r.clientId, r.userLogin, r.userName || '', r.modelId].map(csvEscape);
    csvLines.push(vals.join(','));
  }

  const csv = csvLines.join('\n') + '\n';
  if (args.output) {
    fs.writeFileSync(args.output, csv, 'utf8');
    console.log(`\n✓ Inventory written to ${args.output} (${rows.length} rows)`);
  } else {
    console.log('\n' + csv);
  }
}
