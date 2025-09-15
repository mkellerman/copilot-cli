import https from 'https';
import readline from 'readline';
import { deviceAuth, getCopilotToken, testModels, getValidToken } from '../../core/auth.js';
import { saveToken, loadToken, deleteToken, saveAuthInfo, loadAuthInfo, loadAuthProfiles, saveAuthProfile, getActiveProfile, setActiveProfile, generateProfileId, deleteAuthProfile, AuthProfile } from '../../config/index.js';
import { AUTH_PROVIDERS, getProvider } from '../../core/auth-providers.js';

function askForProvider(): Promise<string> {
  return new Promise((resolve) => {
    console.log('\nSelect authentication provider:');
    console.log('================================\n');
    
    AUTH_PROVIDERS.forEach((provider, index) => {
      console.log(`${index + 1}. ${provider.name}`);
      console.log(`   ${provider.description}`);
      console.log(`   Permissions: ${provider.scopes || 'minimal'}\n`);
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
  return new Promise((resolve) => {
    // Test against Copilot API directly instead of GitHub API
    const testData = JSON.stringify({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gpt-4',
      max_tokens: 1,
      temperature: 0
    });

    const options = {
      hostname: 'api.githubcopilot.com',
      port: 443,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(testData).toString(),
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.0',
        'Openai-Organization': 'github-copilot',
        'User-Agent': 'GitHubCopilotChat/0.11.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // 200 = valid token, 401 = invalid/expired
        resolve(res.statusCode === 200);
      });
    });

    req.on('error', () => resolve(false));
    req.write(testData);
    req.end();
  });
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

export async function status(): Promise<void> {
  const token = await getValidToken();
  const activeProfileId = getActiveProfile();
  const profiles = loadAuthProfiles();
  
  console.log('\nGitHub Copilot Authentication Status');
  console.log('====================================');
  
  if (token && activeProfileId && profiles[activeProfileId]) {
    const profile = profiles[activeProfileId];
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
      console.log(`  Age: ${hours} hour${hours !== 1 ? 's' : ''}`);;
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
  } else {
    console.log('✗ Not authenticated');
    console.log('Run: copilot-cli auth login\n');
    process.exit(1);
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